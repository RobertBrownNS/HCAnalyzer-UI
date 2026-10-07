// QA P2-12: URL round-trip and back/forward behaviour.
import { launch, newPage, sleep } from './cdp.mjs';

const [base, profile] = process.argv.slice(2);
const browser = await launch({ profile, port: 9334 });
try {
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  const state = () => page.eval(`({ search: location.search, hist: history.length,
    measure: document.querySelectorAll('aside select')[1]?.value, kpi: document.querySelector('app-kpi-row li .value')?.textContent.trim() })`);
  const setSelect = (i, v) => page.eval(`(() => { const s = document.querySelectorAll('aside select')[${i}]; s.value = '${v}'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

  await page.goto(`${base}/?flow=revenue&measure=nominal`);
  console.log('start      ', await state());
  await setSelect(1, 'per_capita'); await sleep(800);
  console.log('per_capita ', await state());
  await setSelect(0, 'expenditure'); await sleep(800);
  console.log('expenditure', await state());
  console.log('history.length after 2 changes (replaceUrl check):', await page.eval('history.length'));
  if (process.env.BACK) { await page.eval('history.back()'); await sleep(1200);
  console.log('after back ', await state());
  await page.eval('history.forward()'); await sleep(1200);
  console.log('after fwd  ', await state()); }

  // Round trip: copy a non-default URL into a fresh tab and compare what is shown.
  const url = `${base}/?flow=expenditure&measure=real_per_capita&base=2015&idx=1&from=2010&to=2024&cust=1&cpi=cpi-u-tampa&cpiper=calendar&xfer=net`;
  const a = await newPage(browser.port); await a.viewport(1440, 900); await a.goto(url);
  const b = await newPage(browser.port); await b.viewport(1440, 900); await b.goto(url);
  const snap = (p) => p.eval(`JSON.stringify({ s: location.search, sel: [...document.querySelectorAll('aside select, aside input')].map(e => e.type === 'checkbox' ? e.checked : e.value),
    kpi: [...document.querySelectorAll('app-kpi-row li')].map(l => l.textContent.replace(/\\s+/g,' ').trim()), cap: document.querySelector('.chart-tile .meta')?.textContent.trim() })`);
  const sa = await snap(a), sb = await snap(b);
  console.log('round-trip identical:', sa === sb, 'url unchanged:', JSON.parse(sa).s === url.slice(url.indexOf('?')));
  console.log(sa);
} finally {
  browser.close();
}
