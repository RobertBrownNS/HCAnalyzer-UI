// QA P2-12 (re-check QA-11): after a pinch settles, do URL, readout, KPIs and chart window agree? Is Back one step?
import { launch, newPage, sleep } from './cdp.mjs';
const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-pinch2`, port: 9347 });
const state = (p) => p.eval(`({ url: location.search, hist: history.length,
  readout: document.querySelector('app-range-control .readout')?.textContent.trim(),
  chips: [...document.querySelectorAll('.chips button')].map(b => b.textContent.trim()).find(t => /to FY/.test(t)),
  kpis: [...document.querySelectorAll('app-kpi-row li')].filter(l => l.getBoundingClientRect().width > 0).map(l => l.textContent.replace(/\s+/g, ' ').trim()) })`);
try {
  const page = await newPage(browser.port);
  await page.viewport(390, 844, { mobile: true });
  await page.goto(`${base}/?flow=revenue`);
  const top = await page.eval(`document.querySelector('app-series-chart canvas').getBoundingClientRect().top`);
  await page.eval(`scrollTo(0, ${Math.max(0, Math.round(top - 100))})`); await sleep(300);
  console.log('before', JSON.stringify(await state(page)));
  const c = await page.eval(`(() => { const r = document.querySelector('app-series-chart canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const pts = (d) => [{ x: c.x - d, y: c.y, id: 0 }, { x: c.x + d, y: c.y, id: 1 }];
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) });
  for (let d = 25; d <= 90; d += 5) { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) }); await sleep(16); }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(1500);
  console.log('after ', JSON.stringify(await state(page)));
  await page.shot(`${out}/pinch2-after.png`);
  // Hover-free check of the chart window: first and last x-axis category drawn = range ends?
  await page.eval('history.back()'); await sleep(1200);
  console.log('back  ', JSON.stringify(await state(page)));
} finally { browser.close(); }
