// QA P3-14: (1) header summaries with non-default settings: every active setting readable from the
// collapsed headers; (2) opening the tallest section while scrolled, with a real mouse click
// (CLS counts only shifts without recent input); (3) CLS on load with each stored state at 1366x768
// and 1920x1080 under Fast 4G; (4) phone sheets: no accordion or mode toggle, all checkboxes.
// Usage: node qa/phase3/pane2.mjs <base> <out dir>
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-pane2-${Date.now()}`, port: 9390 });
const CLS = `window.__cls = 0; window.__sh = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__sh.push([Math.round(e.startTime), +e.value.toFixed(4), e.hadRecentInput]); if (!e.hadRecentInput) window.__cls += e.value; } }).observe({ type: 'layout-shift', buffered: true });`;
const heads = `[...document.querySelectorAll('.acc-head')].map(h => h.querySelector('.acc-title').innerText + ': ' + h.querySelector('.acc-summary').innerText)`;
try {
  // (1) Summaries.
  for (const q of [
    '?measure=real_per_capita&base=2015&idx=1&cpi=cpi-u-tampa&cpiper=calendar&cust=1&chart=stacked&cats=ad_valorem,intergovernmental&from=2018&to=2025',
    '?county=pinellas&flow=expenditure&measure=real&funds=general,enterprise,internal_service&chart=bars&cats=public_safety,transportation,human_services,culture_recreation',
    '?xfer=net&measure=per_capita',
    '?funds=general&chart=line&cats=ad_valorem',
  ]) {
    const page = await newPage(browser.port);
    await page.viewport(1366, 768);
    await page.goto(`${base}/${q}`, 1200);
    const r = await page.eval(`({ heads: ${heads}, url: location.search, chips: null })`);
    console.log(`== ${q}\n   url ${r.url}`);
    for (const h of r.heads) console.log('   ' + h);
    await page.close();
  }
  // (2) Open the tallest section while scrolled, real click, in each viewport.
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    const page = await newPage(browser.port);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('fx.filterSections', 'none'); localStorage.setItem('fx.fundsMode', 'advanced'); } catch {} ${CLS}` });
    await page.viewport(w, h);
    await page.goto(`${base}/?chart=stacked`, 1500);
    await page.eval('scrollTo(0, 300)'); await sleep(400);
    const b = await page.eval(`(() => { const r = document.getElementById('acc-funds-head').getBoundingClientRect(); const c = document.querySelector('.chart-tile').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: Math.round(r.top), chartTop: Math.round(c.top), y0: scrollY, sticky: document.querySelector('.filters').classList.contains('sticky') }; })()`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(800);
    const a = await page.eval(`({ top: Math.round(document.getElementById('acc-funds-head').getBoundingClientRect().top), chartTop: Math.round(document.querySelector('.chart-tile').getBoundingClientRect().top), y: scrollY, sticky: document.querySelector('.filters').classList.contains('sticky'), cls: window.__cls, sh: window.__sh })`);
    console.log(`== ${w}x${h} real click on Funds while scrolled: sticky ${b.sticky}->${a.sticky}; header top ${b.top}->${a.top}; chart tile top ${b.chartTop}->${a.chartTop}; scrollY ${b.y0}->${a.y}; CLS ${a.cls.toFixed(4)} shifts ${JSON.stringify(a.sh)}`);
    await page.close();
  }
  // (3) CLS on load with stored states, Fast 4G.
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    for (const [sec, mode, q] of [['view', 'simple', '?chart=stacked'], ['funds', 'advanced', '?chart=stacked'], ['none', 'simple', '?chart=line'], ['categories', 'simple', '?chart=share'], ['inflation', 'simple', '?funds=general,enterprise']]) {
      const page = await newPage(browser.port);
      await page.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
      await page.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('fx.filterSections', '${sec}'); localStorage.setItem('fx.fundsMode', '${mode}'); } catch {} ${CLS}` });
      await page.viewport(w, h);
      await page.goto(`${base}/${q}`, 2500);
      const r = await page.eval(`({ cls: window.__cls, sh: window.__sh, open: [...document.querySelectorAll('.acc-head[aria-expanded=true]')].map(e => e.id) })`);
      console.log(`   load ${w}x${h} stored ${sec}/${mode} ${q}: open ${r.open} CLS ${r.cls.toFixed(6)} ${JSON.stringify(r.sh)}`);
      await page.close();
    }
  }
  // (4) Phone sheets.
  for (const chip of ['Funds', 'Categories', 'Measure', 'County']) {
    const page = await newPage(browser.port);
    await page.viewport(390, 844, { mobile: true, scale: 2 });
    await page.goto(`${base}/?chart=stacked`, 1500);
    await page.eval(`[...document.querySelectorAll('.chips button')].find(b => b.getAttribute('aria-label')?.startsWith('${chip}') || b.innerText.startsWith('${chip}') || (${JSON.stringify(chip)} === 'Funds' && /fund/i.test(b.innerText)) || (${JSON.stringify(chip)} === 'Categories' && /categor/i.test(b.innerText)) || (${JSON.stringify(chip)} === 'Measure' && /dollars/i.test(b.innerText))).click()`);
    await sleep(1000);
    const r = await page.eval(`(() => { const s = document.querySelector('.cdk-overlay-container'); const els = [...s.querySelectorAll('button, input, select')].filter(e => e.getBoundingClientRect().height > 0);
      return { acc: s.querySelectorAll('.acc, .acc-head').length, mode: s.querySelectorAll('.mode-toggle').length, boxes: s.querySelectorAll('input[type=checkbox]').length, visibleBoxes: [...s.querySelectorAll('input[type=checkbox]')].filter(e => e.closest('[hidden]') === null).length,
        small: els.map(e => (e.closest('label') ?? e)).filter(e => e.getBoundingClientRect().height < 44).map(e => e.tagName + ' ' + (e.innerText || e.value || '').slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().height)), focusIn: s.contains(document.activeElement), text: s.innerText.slice(0, 90).replace(/\\s+/g, ' ') }; })()`);
    console.log(`== phone sheet ${chip}: ${JSON.stringify(r)}`);
    await page.close();
  }
} finally {
  browser.close();
}
