// QA P2-12: wheel-up zoom on the chart: what changes, and does the URL/KPI/range follow?
import { launch, newPage, sleep } from './cdp.mjs';
const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-zoom`, port: 9341 });
try {
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.goto(`${base}/?flow=revenue`);
  const state = () => page.eval(`({ url: location.search, kpi: [...document.querySelectorAll('app-kpi-row li')].map(l => l.textContent.replace(/\s+/g,' ').trim()).slice(0, 3), range: document.querySelector('app-range-control .readout')?.textContent.trim() })`);
  console.log('before', JSON.stringify(await state()));
  const box = await page.eval(`(() => { const r = document.querySelector('app-series-chart canvas').getBoundingClientRect(); return { x: r.x + r.width * 0.75, y: r.y + r.height / 2 }; })()`);
  for (let i = 0; i < 8; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -120 }); await sleep(120); }
  await sleep(600);
  console.log('after ', JSON.stringify(await state()));
  await page.eval('scrollTo(0, 0)'); await sleep(200);
  await page.shot(`${out}/zoomed.png`);
} finally { browser.close(); }
