// QA P3-10: URL state for Phase 3 controls. Old links, invalid params, net rule, DR-52 omission,
// DR-53 index-to-100 scope, Back/Forward through chart type, fund preset and category toggles.
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-url3`, port: 9374 });
const squash = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const state = async (page) => {
  const r = await page.eval(`({ url: location.search, hist: history.length,
    chart: document.querySelector('.chart-type select')?.value ?? null,
    kpi: document.querySelector('app-kpi-row li .value')?.textContent ?? null,
    caption: [...document.querySelectorAll('.chart-tile .meta')].map(e => e.innerText).join(' | '),
    netOption: (() => { const o = [...document.querySelectorAll('aside select option')].find(x => x.value === 'net'); return o ? { disabled: o.disabled } : null; })(),
    netHint: document.querySelector('#net-hint')?.innerText ?? null,
    pressed: [...document.querySelectorAll('aside .presets button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.innerText),
    notes: [...document.querySelectorAll('app-view-notes li, .chart-tile .notice, .chart-tile .hint')].map(e => e.innerText).filter(t => t.includes('ndex') || t.includes('Net') || t.includes('net')).slice(0, 3),
    alert: document.querySelector('[role=alert]')?.innerText ?? null })`);
  r.kpi = squash(r.kpi); r.caption = squash(r.caption).slice(0, 200); r.netHint = squash(r.netHint).slice(0, 160);
  return r;
};
const show = (label, s) => console.log(label.padEnd(30), JSON.stringify(s));
try {
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  // Old links (Phase 2 / 4a forms), expected values known from earlier reviews.
  for (const [q, expect] of [
    ['?flow=revenue', '$5.47B'],
    ['?flow=revenue&measure=per_capita&county=pinellas', '$2,859.32'],
    ['?flow=expenditure&measure=nominal&base=2025&idx=0&from=2005&to=2025&cust=0&cpi=cpi-u-us&cpiper=fiscal&xfer=gross&county=hillsborough', '$4.92B'],
  ]) {
    await page.goto(`${base}/${q}`);
    const s = await state(page);
    show(`old link ${expect}`, { url: s.url, chart: s.chart, kpi: s.kpi, ok: s.kpi === expect && s.chart === 'line' });
  }
  // Invalid params.
  for (const q of ['?funds=foo,general&cats=bar&chart=pie', '?funds=nonsense', '?cats=ad_valorem,zzz&chart=stacked', '?funds=general&xfer=net', '?idx=1&chart=stacked', '?idx=1&chart=lines']) {
    await page.goto(`${base}/${q}`);
    show(`invalid ${q}`, await state(page));
  }
  // DR-52: selecting every fund omits funds from the URL.
  await page.goto(`${base}/?funds=general`);
  await page.eval(`[...document.querySelectorAll('aside .presets button')].find(b => b.innerText.trim() === 'All funds').click()`);
  await sleep(800);
  show('All funds preset (DR-52)', await state(page));
  // Back/Forward through chart type, preset, category toggle.
  await page.goto(`${base}/?flow=revenue`);
  const h0 = await page.eval('history.length');
  const setChart = (v) => page.eval(`(() => { const s = document.querySelector('.chart-type select'); s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await setChart('stacked'); await sleep(700);
  await page.eval(`[...document.querySelectorAll('aside .presets button')].find(b => b.innerText.trim() === 'General Fund').click()`); await sleep(700);
  await page.eval(`(() => { const box = [...document.querySelectorAll('aside .fx-check')].find(l => l.innerText.trim() === 'Ad Valorem Taxes').querySelector('input'); box.click(); })()`); await sleep(700);
  const after = await state(page);
  show('after 3 changes', { url: after.url, hist: after.hist - h0, chart: after.chart, pressed: after.pressed });
  const steps = [];
  for (let i = 0; i < 3; i++) { await page.eval('history.back()'); await sleep(900); const s = await state(page); steps.push({ url: s.url, chart: s.chart, pressed: s.pressed }); }
  steps.forEach((s, i) => show(`Back ${i + 1}`, s));
  for (let i = 0; i < 3; i++) { await page.eval('history.forward()'); await sleep(900); }
  const fwd = await state(page);
  show('Forward x3', { url: fwd.url, chart: fwd.chart, same: fwd.url === after.url });
} finally {
  browser.close();
}
