// QA P2-12: does a mouse wheel over the chart scroll the page or get captured by chart zoom?
import { launch, newPage, sleep } from './cdp.mjs';
const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-wheel`, port: 9340 });
try {
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.goto(`${base}/?flow=revenue`);
  const box = await page.eval(`(() => { const r = document.querySelector('app-series-chart canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const xLabels = () => page.eval(`document.querySelector('.chart-tile').getBoundingClientRect().top`);
  const before = await page.eval('scrollY');
  for (let i = 0; i < 5; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 120 }); await sleep(120); }
  await sleep(500);
  console.log('scrollY before', before, 'after 5 wheel-downs over chart', await page.eval('scrollY'));
  // Same wheel outside the chart, for comparison
  await page.eval('scrollTo(0,0)'); await sleep(200);
  for (let i = 0; i < 5; i++) { await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 600, y: 150, deltaX: 0, deltaY: 120 }); await sleep(120); }
  await sleep(500);
  console.log('scrollY after 5 wheel-downs over KPI area', await page.eval('scrollY'));
  await page.shot(`${out}/after-wheel.png`);
} finally { browser.close(); }
