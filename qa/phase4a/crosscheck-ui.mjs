// QA P4a-06: on-screen cross-check wording. For each county and flow: the notice shown under the
// EDR AFR source in "Settings and sources" must equal that source's crossCheckSummary, and the
// chart tooltip must carry the right status line for a not-checked, a mismatch and a matching year.
import { launch, newPage, sleep } from '../phase2/cdp.mjs';
import { readFileSync } from 'node:fs';

const [base, out, sourcesPath] = process.argv.slice(2);
const sources = Object.fromEntries(JSON.parse(readFileSync(sourcesPath, 'utf8')).map((s) => [s.id, s]));
const LABELS = {
  full: 'Cross-checked: matches the county-filed AFR',
  'not-checked': 'Not cross-checked against the county-filed AFR',
  // QA-35 (b25cecc): text built from the range's counts; both current mismatch years are one
  // reclassified amount with equal yearly totals.
  mismatch: 'Total matches; 1 amount classified differently',
};
const cases = [
  ['hillsborough', 'revenue', { 2010: 'not-checked', 2020: 'full' }],
  ['hillsborough', 'expenditure', { 2010: 'not-checked', 2015: 'mismatch', 2020: 'full' }],
  ['pinellas', 'revenue', { 2010: 'not-checked', 2014: 'mismatch', 2020: 'full' }],
  ['pinellas', 'expenditure', { 2010: 'not-checked', 2020: 'full' }],
];
const browser = await launch({ profile: `${out}/profile-ccui`, port: 9363 });
try {
  for (const [county, flow, years] of cases) {
    const page = await newPage(browser.port);
    await page.viewport(1440, 900);
    await page.goto(`${base}/?county=${county}&flow=${flow}`);
    const id = `edr-afr-${flow === 'revenue' ? 'revenues' : 'expenditures'}-${county}`;
    const notices = await page.eval(`[...document.querySelectorAll('app-methodology .notice')].map(n => n.textContent.trim())`);
    const summaryShown = notices.includes(sources[id].crossCheckSummary);
    const otherCounty = notices.filter((n) => n !== sources[id].crossCheckSummary);
    // Tooltip per target year: hover across the canvas and keep the first tooltip for each year.
    const box = await page.eval(`(() => { const r = document.querySelector('app-series-chart canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    const found = {};
    for (let x = box.x + 30; x < box.x + box.w - 5; x += 10) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: box.y + box.h / 2 });
      await sleep(70);
      const t = await page.eval(`(() => { const d = [...document.querySelectorAll('app-series-chart div')].find(e => (e.getAttribute('style') || '').includes('position: absolute') && e.textContent.includes('FY ')); return d ? d.innerText : null; })()`);
      const m = t && t.match(/FY (\d{4})-\d{2}/);
      if (m) { const fy = Number(m[1]) + 1; if (years[fy] && !found[fy]) found[fy] = t; }
    }
    const tips = Object.entries(years).map(([fy, st]) => {
      const t = found[fy];
      const lines = t ? Object.values(LABELS).filter((l) => t.includes(l)) : [];
      return `FY${fy} expect "${st}" -> ${t ? (lines.length === 1 && lines[0] === LABELS[st] ? 'ok' : 'WRONG ' + JSON.stringify(lines)) : 'not captured'}`;
    });
    console.log(`${county} ${flow}: summary shown ${summaryShown}; other notices on page ${otherCounty.length}; ${tips.join('; ')}`);
    await page.close();
  }
} finally {
  browser.close();
}
