// QA P3-10 final recheck (QA-39, QA-40, QA-42, DR-54 "Matches" rule).
// Usage: node qa/phase3/p3final.mjs <base> <out dir>
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-p3final`, port: 9384 });
const sq = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const toTable = (page) =>
  page.eval(`[...document.querySelectorAll('.chart-tile button')].find(b => b.textContent.trim() === 'Table')?.click()`).then(() => sleep(700));
const visibleTable = `[...document.querySelectorAll('.chart-tile table')].find(t => t.getBoundingClientRect().height > 0)`;
const tableInfo = (page) => page.eval(`(() => { const t = ${visibleTable}; if (!t) return null;
  return { caption: t.querySelector('caption')?.innerText ?? '', head: [...t.querySelectorAll('thead th')].map(th => th.innerText.trim()),
    rows: [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.innerText.trim())) }; })()`);
let problems = 0;
const bad = (msg) => { problems++; console.log('  !! ' + msg); };
try {
  // ---- QA-39 / DR-53 ----
  console.log('== QA-39: idx=1&base=2010');
  for (const county of ['hillsborough', 'pinellas']) {
    for (const chart of ['line', 'lines', 'stacked', 'share', 'bars']) {
      const page = await newPage(browser.port);
      await page.viewport(1440, 900);
      await page.goto(`${base}/?county=${county}&idx=1&base=2010&chart=${chart}`);
      const r = await page.eval(`({ meta: [...document.querySelectorAll('.chart-tile .meta')].map(e => e.innerText), kpi: [...document.querySelectorAll('app-kpi-row li')].map(li => li.innerText),
        includes: document.querySelector('.scope-includes')?.innerText ?? null })`);
      if (county === 'hillsborough' && ['stacked', 'share', 'bars', 'lines'].includes(chart)) await page.shot(`${out}/idx-${chart}.png`);
      await toTable(page);
      const t = await tableInfo(page);
      const lineType = chart === 'line' || chart === 'lines';
      const kpi = sq(r.kpi.join(' | '));
      const meta = sq(r.meta.join(' | '));
      console.log(`${county} ${chart}`.padEnd(22), '| meta:', meta.slice(0, 230), '\n'.padEnd(24), '| kpi:', kpi.slice(0, 150), '\n'.padEnd(24), '| table caption:', sq(t?.caption).slice(0, 120), '| row FY2010:', JSON.stringify(t?.rows.find((x) => x[0] === 'FY 2009-10')?.slice(0, 3)));
      if (!lineType) {
        if (/ndex,? FY/.test(kpi) || /ndex,? FY/.test(sq(t?.caption)) || /\bIndex, FY/.test(meta)) bad(`${county} ${chart}: index label on a non-line chart`);
        if (!meta.includes('Index to 100 applies to the line charts only')) bad(`${county} ${chart}: no index note`);
        if (chart === 'share' && !sq(t?.caption).includes('Share of the selected total (%)') && !meta.includes('Share of the selected total (%)')) bad(`${county} share: caption`);
      } else if (!/ndex/.test(meta)) bad(`${county} ${chart}: line chart lost its index label`);
      await page.close();
    }
  }
  // Drawer value under idx=1 on stacked (category cell) and on line (total row).
  for (const [q, cell] of [['?idx=1&base=2010&chart=stacked', true], ['?idx=1&base=2010&chart=line', false]]) {
    const page = await newPage(browser.port);
    await page.viewport(1440, 900);
    await page.goto(`${base}/${q}`);
    await toTable(page);
    await page.eval(`(() => { const t = ${visibleTable}; const tr = [...t.querySelectorAll('tbody tr')].find(r => r.children[0].innerText.trim() === 'FY 2014-15');
      (${cell} ? tr.children[1].querySelector('button') : tr.querySelector('button')).click(); })()`);
    await sleep(900);
    const d = await page.eval(`[...document.querySelectorAll('.cdk-overlay-container app-source-drawer dl.values dt')].map(dt => dt.innerText.trim() + ': ' + dt.nextElementSibling.innerText.trim()).join(' | ')`);
    console.log(`drawer ${q}:`, sq(d).slice(0, 300));
    await page.close();
  }

  // ---- QA-40: total table, cross-check column ----
  console.log('== QA-40 total table, cross-check text per scope');
  const cases = [
    ['hillsborough', 'expenditure', 'FY 2014-15', [['', 'Total matches'], ['funds=internal_service', 'differs by $1,164,281'], ['funds=component_unit', 'differs by $1,164,281'],
      ['funds=internal_service,component_unit', 'Total matches'], ['funds=general', 'Matches'], ['funds=general,internal_service', 'differs by $1,164,281'], ['funds=general&cust=1', 'Matches']]],
    ['pinellas', 'revenue', 'FY 2013-14', [['', 'Total matches'], ['funds=special_revenue', 'Total matches'], ['funds=general', 'Matches'], ['funds=enterprise,general', 'Matches']]],
  ];
  for (const [county, flow, fy, scopes] of cases) {
    for (const [extra, want] of scopes) {
      const page = await newPage(browser.port);
      await page.viewport(1440, 900);
      await page.goto(`${base}/?county=${county}&flow=${flow}&${extra}`);
      await toTable(page);
      const t = await tableInfo(page);
      const row = t.rows.find((x) => x[0] === fy) ?? [];
      const cc = row[t.head.indexOf('Cross-check')];
      const ok = want === 'Matches' ? cc === 'Matches' : cc.includes(want);
      console.log(`${county} ${flow} ${extra || '(all)'}`.padEnd(60), `${fy}: "${cc}"`, ok ? 'OK' : 'FAIL');
      if (!ok) bad(`${county} ${extra}: expected ${want}`);
      await page.close();
    }
  }

  // ---- DR-54: "Matches" never for not-checked years ----
  console.log('== DR-54 sweep: cross-check column for FY <= 2011-12');
  const scopes = ['', 'funds=general', 'funds=internal_service', 'funds=component_unit', 'funds=special_revenue', 'funds=enterprise', 'cust=1', 'measure=per_capita_real&chart=line'];
  for (const county of ['hillsborough', 'pinellas']) {
    for (const flow of ['revenue', 'expenditure']) {
      for (const extra of scopes) {
        const page = await newPage(browser.port);
        await page.viewport(1440, 900);
        await page.goto(`${base}/?county=${county}&flow=${flow}&from=2005&to=2025&${extra}`);
        await toTable(page);
        const t = await tableInfo(page);
        const ccCol = t.head.indexOf('Cross-check');
        const early = t.rows.filter((x) => Number(x[0].slice(3, 7)) + 1 <= 2012);
        const matched = early.filter((x) => /atch/.test(x[ccCol]));
        const values = [...new Set(early.map((x) => x[ccCol]))];
        const later = [...new Set(t.rows.filter((x) => Number(x[0].slice(3, 7)) + 1 >= 2013).map((x) => x[ccCol]))];
        console.log(`${county} ${flow} ${extra || '(all)'}`.padEnd(64), `head "${t.head[ccCol]}"; FY<=2012 rows ${early.length}: ${JSON.stringify(values)}; FY>=2013: ${JSON.stringify(later)}`);
        if (matched.length) bad(`${county} ${flow} ${extra}: "match" in a not-checked year: ${JSON.stringify(matched[0])}`);
        await page.close();
      }
    }
  }

  // ---- QA-42: under the chart ----
  console.log('== QA-42');
  for (const [county, extra] of [['hillsborough', ''], ['pinellas', ''], ['hillsborough', '&funds=general'], ['pinellas', '&chart=stacked'], ['hillsborough', '&funds=general,enterprise']]) {
    const page = await newPage(browser.port);
    await page.viewport(1440, 900);
    await page.goto(`${base}/?county=${county}${extra}`);
    const s = await page.eval(`document.querySelector('.scope-includes')?.innerText ?? null`);
    console.log(`${county}${extra}`.padEnd(40), JSON.stringify(s));
    await page.close();
  }
} finally {
  browser.close();
}
console.log(`${problems} problems`);
