// QA P3-10: DR-53 (index-to-100 only on Line / Lines; other chart types show values without the
// index and say so) and DR-54 (approved strings rendered exactly). Prints what each view shows.
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-dr53`, port: 9380 });
const sq = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const APPROVED = {
  netHint: 'Excluded (net) needs all funds selected (every fund with data for this county): with only some funds, transfers to and from the others are real inflows and outflows.',
  custom: 'Custom selection.',
  share: 'Share of selected total',
  mappingIntro: 'Categories are the Florida Uniform Accounting System (UAS) account classes, as published by the Department of Financial Services, with Ad Valorem Taxes (311) shown separately.',
  editions: 'UAS Manual editions used:',
};
try {
  for (const county of ['hillsborough', 'pinellas']) {
    for (const chart of ['line', 'lines', 'stacked', 'share', 'bars']) {
      const page = await newPage(browser.port);
      await page.viewport(1440, 900);
      await page.goto(`${base}/?county=${county}&idx=1&base=2010&chart=${chart}`);
      const r = await page.eval(`({ kpi: document.querySelector('app-kpi-row')?.innerText, meta: [...document.querySelectorAll('.chart-tile .meta, .chart-tile .hint, .chart-tile .notice')].map(e => e.innerText).join(' | '),
        body: document.body.innerText })`);
      const says = /index[^.]{0,80}(line|not applied|only)/i.exec(r.body)?.[0] ?? null;
      console.log(`DR-53 ${county} ${chart}`.padEnd(30), '| meta:', sq(r.meta).slice(0, 120), '| kpi:', sq(r.kpi).slice(0, 70), '| says-not-applied:', JSON.stringify(says));
      await page.close();
    }
  }
  // DR-54 strings.
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.goto(`${base}/?funds=general,enterprise&chart=share`);
  await page.eval(`document.querySelectorAll('details').forEach(d => d.open = true)`);
  const got = await page.eval(`({ netHint: document.querySelector('#net-hint')?.innerText, scope: [...document.querySelectorAll('aside .hint')].map(e => e.innerText).find(t => t.includes('Custom selection')),
    body: document.body.innerText,
    seriesNames: (() => { const el = document.querySelector('app-series-chart [_echarts_instance_]'); const inst = el && window.echarts?.getInstanceByDom(el); return inst ? inst.getOption().series.map(s => s.name) : null; })() })`);
  await page.eval(`[...document.querySelectorAll('.chart-tile button')].find(b => b.textContent.trim() === 'Table')?.click()`);
  await sleep(600);
  const tableText = await page.eval(`[...document.querySelectorAll('.chart-tile table')].map(t => t.innerText).join('\\n')`);
  const all = got.body + '\n' + tableText;
  console.log('DR-54 net hint exact:', sq(got.netHint) === APPROVED.netHint, JSON.stringify(sq(got.netHint)));
  console.log('DR-54 scope hint:', JSON.stringify(sq(got.scope)));
  for (const k of ['custom', 'share', 'mappingIntro', 'editions']) console.log(`DR-54 ${k} on page:`, sq(all).includes(APPROVED[k]));
  console.log('series names (if echarts global):', JSON.stringify(got.seriesNames));
  await page.close();
} finally {
  browser.close();
}
