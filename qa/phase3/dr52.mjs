// QA P3-10 (DR-52): omitted funds/cats mean "all", in both counties. For each county and flow:
// (a) an old Phase 2/4a link (no Phase 3 params), (b) the same view with every fund and category
// listed explicitly, (c) the same with chart=line written out: the KPI row, caption and table must
// be identical. Then re-selecting every category in the UI must drop `cats` from the URL again.
import { launch, newPage, sleep } from '../phase2/cdp.mjs';
import { readFileSync } from 'node:fs';

const [base, out, dataDir] = process.argv.slice(2);
const cats = JSON.parse(readFileSync(`${dataDir}/categories.json`, 'utf8'));
const browser = await launch({ profile: `${out}/profile-dr52`, port: 9379 });
const grab = (page) => page.eval(`({ url: location.search,
  kpi: [...document.querySelectorAll('app-kpi-row li')].map(li => li.innerText.replace(/\\s+/g, ' ')).join(' | '),
  caption: [...document.querySelectorAll('.chart-tile .meta')].map(e => e.innerText.replace(/\\s+/g, ' ')).join(' | '),
  chart: document.querySelector('.chart-type select')?.value,
  pressed: [...document.querySelectorAll('aside .presets button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.innerText.trim()) })`);
const table = async (page) => {
  await page.eval(`[...document.querySelectorAll('.chart-tile button')].find(b => b.textContent.trim() === 'Table')?.click()`);
  await sleep(600);
  return page.eval(`[...document.querySelectorAll('.chart-tile table')].filter(t => t.getBoundingClientRect().height > 0).map(t => t.innerText).join('\\n')`);
};
let failures = 0;
try {
  for (const county of ['hillsborough', 'pinellas']) {
    const funds = JSON.parse(readFileSync(`${dataDir}/${county}.observations.json`, 'utf8'));
    const fundIds = [...new Set((funds.observations ?? funds).map((o) => o.fundType))].filter((f) => f !== 'custodial');
    for (const flow of ['revenue', 'expenditure']) {
      const catIds = cats.filter((c) => c.flow === flow).map((c) => c.id);
      const old = `?flow=${flow}&measure=per_capita&base=2025&from=2008&to=2025&county=${county}`;
      const variants = [
        ['old link', old],
        ['explicit all + line', `${old}&chart=line&funds=${fundIds.join(',')}`],
        ['stacked, omitted', `${old}&chart=stacked`],
        ['stacked, explicit all', `${old}&chart=stacked&funds=${fundIds.join(',')}&cats=${catIds.join(',')}`],
      ];
      const got = [];
      for (const [name, q] of variants) {
        const page = await newPage(browser.port);
        await page.viewport(1440, 900);
        await page.goto(`${base}/${q}`);
        const s = await grab(page);
        s.table = await table(page);
        got.push([name, s]);
        await page.close();
      }
      const same = (a, b) => a.kpi === b.kpi && a.caption === b.caption && a.table === b.table && a.chart === b.chart && a.pressed.join() === b.pressed.join();
      const ok1 = same(got[0][1], got[1][1]);
      const ok2 = same(got[2][1], got[3][1]);
      if (!ok1 || !ok2) failures++;
      console.log(`== ${county} ${flow}: funds in data ${fundIds.length}; line old==explicit ${ok1}; stacked omitted==explicit ${ok2}`);
      for (const [name, s] of got) console.log(`   ${name.padEnd(22)} chart=${s.chart} pressed=${s.pressed} kpi=${s.kpi.slice(0, 90)} | table ${s.table.length} chars`);
      // Untick then re-tick one category: `cats` must disappear from the URL again.
      const page = await newPage(browser.port);
      await page.viewport(1440, 900);
      await page.goto(`${base}/${old}&chart=stacked`);
      const label = cats.find((c) => c.flow === flow).label;
      const tick = `(() => { const l = [...document.querySelectorAll('aside .fx-check')].find(l => l.innerText.trim() === ${JSON.stringify(label)}); l.querySelector('input').click(); })()`;
      await page.eval(tick); await sleep(600);
      const mid = await page.eval('location.search');
      await page.eval(tick); await sleep(600);
      const end = await page.eval('location.search');
      const ok3 = /[?&]cats=/.test(mid) && !/[?&]cats=/.test(end) && !/[?&]funds=/.test(end) && /[?&]chart=stacked/.test(end);
      if (!ok3) failures++;
      console.log(`   re-tick "${label}": after untick ${mid.match(/cats=[^&]*/)?.[0].slice(0, 60)}; after re-tick cats present ${/[?&]cats=/.test(end)}, chart written ${/chart=/.test(end)} -> ${ok3 ? 'OK' : 'FAIL'}`);
      await page.close();
    }
  }
} finally {
  browser.close();
}
console.log(`${failures} failures`);
