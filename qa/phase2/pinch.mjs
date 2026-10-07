// QA P2-12: two-finger pinch on the chart at phone width (touch emulation).
import { launch, newPage, sleep } from './cdp.mjs';
const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-pinch`, port: 9345 });
try {
  const page = await newPage(browser.port);
  await page.viewport(390, 844, { mobile: true });
  await page.goto(`${base}/?flow=revenue`);
  const b = await page.eval(`(() => { const r = document.querySelector('app-series-chart canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.y }; })()`);
  await page.eval(`scrollTo(0, ${Math.max(0, Math.round(b.top - 100))})`); await sleep(300);
  const c = await page.eval(`(() => { const r = document.querySelector('app-series-chart canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.shot(`${out}/pinch-before.png`);
  const pts = (d) => [{ x: c.x - d, y: c.y, id: 0 }, { x: c.x + d, y: c.y, id: 1 }];
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) });
  for (let d = 25; d <= 150; d += 5) { await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) }); await sleep(16); }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(800);
  await page.shot(`${out}/pinch-after.png`);
  console.log('url after pinch', await page.eval('location.search'));
} finally { browser.close(); }
