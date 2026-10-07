// QA P2-12: hover the chart and read the ECharts tooltip for given fiscal years.
import { launch, newPage, sleep } from './cdp.mjs';
const [base, out, query, years] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-tip`, port: 9338 });
try {
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.goto(`${base}/${query}`);
  const box = await page.eval(`(() => { const c = document.querySelector('app-series-chart canvas'); const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const want = years.split(',');
  const found = {};
  for (let x = box.x + 40; x < box.x + box.w - 10 && Object.keys(found).length < want.length; x += 12) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: box.y + box.h / 2 });
    await sleep(150);
    const t = await page.eval(`(() => { const d = [...document.querySelectorAll('app-series-chart div')].find(e => (e.getAttribute('style')||'').includes('position: absolute') && /FY \\d{4}-\\d{2}/.test(e.textContent)); return d ? d.innerText : null; })()`);
    const m = t && t.match(/FY \d{4}-\d{2}/);
    if (m && want.includes(m[0]) && !found[m[0]]) found[m[0]] = t;
  }
  for (const y of want) console.log('----', y, '\n' + (found[y] ?? '(not captured)'));
} finally { browser.close(); }
