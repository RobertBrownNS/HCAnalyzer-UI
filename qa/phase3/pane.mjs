// QA P3-13 / P3-14: desktop Filters pane (accordion, one section open, one page scrollbar) and the
// Simple/Advanced fund filter. Per viewport x theme: default state on a fresh profile, each section
// opened in turn (and Funds in Advanced), all closed, scroll containers, sticky/static, the
// scroll-anchoring when a section opens while scrolled, URL/history unchanged by toggles, stored
// state across reloads, unknown id, custom-selection link, blocked storage, keyboard, contrast.
// Usage: node qa/phase3/pane.mjs <base> <out dir>
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
let problems = 0;
const bad = (m) => { problems++; console.log('   !! ' + m); };
const browser = await launch({ profile: `${out}/profile-pane-${Date.now()}`, port: 9389 });

const STATE = `(() => {
  const pane = document.querySelector('aside.filters, .filters');
  const heads = [...document.querySelectorAll('.acc-head')];
  const scrollers = [...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1 && e !== document.documentElement && e !== document.body; })
    .map(e => e.tagName.toLowerCase() + '.' + String(e.className).trim().split(/\\s+/).slice(0, 2).join('.') + ' ' + e.clientHeight + '/' + e.scrollHeight);
  const r = pane.getBoundingClientRect();
  return { url: location.search, hist: history.length,
    sections: heads.map(h => ({ id: h.id, title: h.querySelector('.acc-title').innerText, summary: h.querySelector('.acc-summary').innerText, expanded: h.getAttribute('aria-expanded'),
      controls: h.getAttribute('aria-controls'), target: !!document.getElementById(h.getAttribute('aria-controls')), h: Math.round(h.getBoundingClientRect().height),
      bodyHidden: document.getElementById(h.getAttribute('aria-controls'))?.hidden })),
    pane: { top: Math.round(r.top), height: Math.round(r.height), sticky: pane.classList.contains('sticky'), position: getComputedStyle(pane).position, overflowY: getComputedStyle(pane).overflowY },
    vh: innerHeight, docScroll: document.documentElement.scrollHeight - innerHeight, scrollers,
    fundBoxes: [...document.querySelectorAll('#fund-checkboxes')].map(e => !e.hidden && e.getBoundingClientRect().height > 0),
    modeToggle: document.querySelector('.mode-toggle')?.innerText.trim() ?? null,
    store: (() => { try { return { s: localStorage.getItem('fx.filterSections'), m: localStorage.getItem('fx.fundsMode') }; } catch { return 'blocked'; } })(),
    kpi: document.querySelector('app-kpi-row')?.innerText.replace(/\\s+/g, ' ') ?? null };
})()`;
const open = (s) => s.sections.filter((x) => x.expanded === 'true').map((x) => x.id.replace(/^acc-|-head$/g, ''));
const click = (page, id) => page.eval(`document.getElementById('acc-${id}-head').click()`).then(() => sleep(500));

async function fresh(view, query, pre = '') {
  const page = await newPage(browser.port);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `${pre}
    window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });` });
  await page.viewport(view.w, view.h, { dark: view.dark });
  await page.goto(`${base}/${query}`, 1500);
  return page;
}
const CLEAR = `try { if (!sessionStorage.getItem('qa-cleared')) { localStorage.clear(); sessionStorage.setItem('qa-cleared', '1'); } } catch {}`;

try {
  for (const view of [{ w: 1366, h: 768, dark: false }, { w: 1366, h: 768, dark: true }, { w: 1920, h: 1080, dark: false }, { w: 1920, h: 1080, dark: true }]) {
    const tag = `${view.w}x${view.h} ${view.dark ? 'dark' : 'light'}`;
    console.log(`== ${tag}`);
    const page = await fresh(view, '?chart=stacked', CLEAR);
    let s = await page.eval(STATE);
    console.log(`   default: open=${open(s)} mode=${s.modeToggle} sticky=${s.pane.sticky} pane ${s.pane.height}px vh ${s.vh} overflowY ${s.pane.overflowY} scrollers ${JSON.stringify(s.scrollers)} cls=${await page.eval('window.__cls')}`);
    if (open(s).join() !== 'view') bad(`${tag}: default open ${open(s)}`);
    if (s.modeToggle !== 'Advanced') bad(`${tag}: default mode not Simple (toggle reads ${s.modeToggle})`);
    for (const x of s.sections) {
      if (!x.target || x.h < 44) bad(`${tag}: header ${x.id} target ${x.target} height ${x.h}`);
      if ((x.expanded === 'true') === x.bodyHidden) bad(`${tag}: ${x.id} expanded ${x.expanded} but hidden ${x.bodyHidden}`);
    }
    console.log('   headers:', s.sections.map((x) => `${x.title} [${x.summary}] h=${x.h}`).join(' | '));
    const url0 = s.url, hist0 = s.hist, kpi0 = s.kpi;
    // Each section in turn, then Funds in Advanced, then all closed.
    const steps = [];
    for (const id of ['inflation', 'funds', 'categories', 'view']) {
      await click(page, id);
      s = await page.eval(STATE);
      steps.push([`open ${id}`, s]);
    }
    await click(page, 'funds');
    await page.eval(`document.querySelector('.mode-toggle').click()`); await sleep(500);
    s = await page.eval(STATE); steps.push(['funds advanced', s]);
    await click(page, 'funds');
    s = await page.eval(STATE); steps.push(['all closed', s]);
    for (const [name, st] of steps) {
      console.log(`   ${name.padEnd(15)} open=[${open(st)}] pane ${st.pane.height}px sticky=${st.pane.sticky} pos=${st.pane.position} docScroll=${st.docScroll} scrollers=${JSON.stringify(st.scrollers)} store=${JSON.stringify(st.store)}`);
      if (st.scrollers.length) bad(`${tag} ${name}: inner scroll container ${JSON.stringify(st.scrollers)}`);
      if (st.pane.overflowY !== 'visible') bad(`${tag} ${name}: pane overflow ${st.pane.overflowY}`);
      const fits = st.pane.height <= st.vh - 48 + 1;
      if (st.pane.sticky !== fits && Math.abs(st.pane.height - (st.vh - 48)) > 2) console.log(`      (sticky ${st.pane.sticky} vs fits ${fits}: header height may differ from 48)`);
      if (st.url !== url0 || st.hist !== hist0) bad(`${tag} ${name}: URL/history changed ${st.url} ${st.hist - hist0}`);
      if (st.kpi !== kpi0) bad(`${tag} ${name}: KPIs changed`);
    }
    if (open(steps[0][1]).join() !== 'inflation' || open(steps[1][1]).join() !== 'funds' || open(steps[2][1]).join() !== 'categories' || open(steps[3][1]).join() !== 'view') bad(`${tag}: one-at-a-time failed`);
    if (open(steps[5][1]).length !== 0) bad(`${tag}: closing left something open`);
    // Reload keeps "none" and Advanced.
    await page.goto(`${base}/?chart=stacked`, 1200);
    s = await page.eval(STATE);
    console.log(`   reload: open=[${open(s)}] toggle=${s.modeToggle} store=${JSON.stringify(s.store)} cls=${await page.eval('window.__cls')}`);
    if (open(s).length !== 0 || s.modeToggle !== 'Simple') bad(`${tag}: reload state lost`);
    // Sticky behaviour: Funds open (Advanced) is the tallest; scroll then check pane top.
    await click(page, 'funds');
    s = await page.eval(STATE);
    await page.eval('scrollTo(0, 300)'); await sleep(300);
    const topAfter = await page.eval(`Math.round(document.querySelector('.filters').getBoundingClientRect().top)`);
    console.log(`   tallest (funds adv): pane ${s.pane.height}px sticky=${s.pane.sticky}; after scroll 300 pane top ${s.pane.top} -> ${topAfter}`);
    await page.eval('scrollTo(0, 0)'); await click(page, 'funds'); // all closed again
    s = await page.eval(STATE);
    await page.eval('scrollTo(0, 300)'); await sleep(300);
    const topClosed = await page.eval(`Math.round(document.querySelector('.filters').getBoundingClientRect().top)`);
    console.log(`   all closed: pane ${s.pane.height}px sticky=${s.pane.sticky}; after scroll 300 pane top ${s.pane.top} -> ${topClosed}`);
    // Open the tallest while scrolled: the clicked header must stay put.
    const hdBefore = await page.eval(`Math.round(document.getElementById('acc-funds-head').getBoundingClientRect().top)`);
    await click(page, 'funds'); await sleep(300);
    const after = await page.eval(`({ hd: Math.round(document.getElementById('acc-funds-head').getBoundingClientRect().top), sticky: document.querySelector('.filters').classList.contains('sticky'), y: scrollY })`);
    console.log(`   open funds while scrolled: header top ${hdBefore} -> ${after.hd}; sticky=${after.sticky}; scrollY ${after.y}; cls=${await page.eval('window.__cls')}`);
    if (Math.abs(after.hd - hdBefore) > 2) bad(`${tag}: header jumped ${hdBefore} -> ${after.hd}`);
    // Keyboard: Enter and Space on a header.
    await page.eval('scrollTo(0, 0)');
    await page.eval(`document.getElementById('acc-inflation-head').focus()`);
    for (const [k, code, vk, text] of [['Enter', 'Enter', 13, '\r'], [' ', 'Space', 32, ' ']]) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
      await sleep(400);
      const st = await page.eval(STATE);
      console.log(`   key ${code}: open=[${open(st)}]`);
    }
    const focus = await page.eval(`(() => { const e = document.activeElement; const s = getComputedStyle(e); return { id: e.id, fv: e.matches(':focus-visible'), outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor }; })()`);
    console.log(`   focus: ${JSON.stringify(focus)}`);
    if (!focus.fv || focus.outline.startsWith('none')) bad(`${tag}: no visible focus on header`);
    // Contrast of header title and summary against the pane background.
    const contrast = await page.eval(`(() => { const lum = (c) => { const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bgOf = (e) => { while (e) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c; e = e.parentElement; } return 'rgb(255,255,255)'; };
      return [...document.querySelectorAll('.acc-title, .acc-summary, .mode-toggle')].slice(0, 3).map(e => { const a = lum(getComputedStyle(e).color), b = lum(bgOf(e)); return e.className + ' ' + ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2); }); })()`);
    console.log(`   contrast: ${contrast.join(', ')}`);
    await page.close();
  }

  // Custom selection link with stored Inflation + Simple; unknown id; blocked storage.
  const v = { w: 1366, h: 768, dark: false };
  let page = await fresh(v, '?funds=general,enterprise', `try { localStorage.setItem('fx.filterSections', 'inflation'); localStorage.setItem('fx.fundsMode', 'simple'); } catch {}`);
  let s = await page.eval(STATE);
  console.log(`== custom link: open=[${open(s)}] checkboxes shown ${s.fundBoxes} toggle=${s.modeToggle} store=${JSON.stringify(s.store)} funds summary "${s.sections.find((x) => x.id === 'acc-funds-head')?.summary}" url ${s.url}`);
  if (open(s).join() !== 'funds' || !s.fundBoxes[0] || s.store.s !== 'inflation' || s.store.m !== 'simple') bad('custom link: Funds/Advanced not forced or storage altered');
  // A preset click from the custom state, then a new custom selection from a checkbox.
  await page.eval(`[...document.querySelectorAll('.presets button')].find(b => b.innerText.trim() === 'General Fund').click()`); await sleep(600);
  s = await page.eval(STATE);
  console.log(`   after preset General: open=[${open(s)}] boxes ${s.fundBoxes} url ${s.url}`);
  await page.close();
  page = await fresh(v, '?chart=stacked', `try { localStorage.setItem('fx.filterSections', 'bogus'); localStorage.setItem('fx.fundsMode', 'weird'); } catch {}`);
  s = await page.eval(STATE);
  console.log(`== unknown ids: open=[${open(s)}] toggle=${s.modeToggle} console ${JSON.stringify(page.console)}`);
  if (open(s).join() !== 'view' || s.modeToggle !== 'Advanced') bad('unknown id fallback');
  await page.close();
  for (const [name, q] of [['plain', '?chart=stacked'], ['custom', '?funds=general,enterprise']]) {
    page = await fresh(v, q, `Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } });`);
    s = await page.eval(STATE);
    const before = open(s).join();
    await click(page, 'inflation');
    const after2 = open(await page.eval(STATE)).join();
    const t = await page.eval(`document.querySelector('.mode-toggle')?.innerText`);
    await page.eval(`document.querySelector('.mode-toggle').click()`); await sleep(400);
    const t2 = await page.eval(`document.querySelector('.mode-toggle')?.innerText`);
    console.log(`== blocked storage (${name}): store=${JSON.stringify(s.store)} open=[${before}] -> inflation click [${after2}]; toggle ${t} -> ${t2}; alert ${await page.eval(`document.querySelector('[role=alert]')?.innerText ?? null`)}; console ${JSON.stringify(page.console)}`);
    if (page.console.length) bad(`blocked storage (${name}): console errors`);
    await page.close();
  }
} finally {
  browser.close();
}
console.log(`${problems} problems`);
