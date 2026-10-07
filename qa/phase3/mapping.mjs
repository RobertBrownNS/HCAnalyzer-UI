// QA P3-09/10: the published category mapping on the page vs categories.json, the editions listed,
// and the link from the Categories control (focus lands on the mapping heading).
import { launch, newPage, sleep } from '../phase2/cdp.mjs';
import { readFileSync } from 'node:fs';

const [base, out, catsPath, sourcesPath] = process.argv.slice(2);
const cats = JSON.parse(readFileSync(catsPath, 'utf8'));
const sources = Object.fromEntries(JSON.parse(readFileSync(sourcesPath, 'utf8')).map((s) => [s.id, s]));
const browser = await launch({ profile: `${out}/profile-mapping`, port: 9376 });
try {
  for (const flow of ['revenue', 'expenditure']) {
    const page = await newPage(browser.port);
    await page.viewport(1440, 900);
    await page.goto(`${base}/?chart=stacked&flow=${flow}`);
    await page.eval(`[...document.querySelectorAll('aside button')].find(b => b.textContent.includes('How account codes map')).click()`);
    await sleep(800);
    const r = await page.eval(`({ focus: document.activeElement.id, rows: [...document.querySelectorAll('#category-mapping ~ .mapping tbody tr')].map(tr => [...tr.children].map(td => td.innerText.trim())),
      head: [...document.querySelectorAll('#category-mapping ~ .mapping thead th')].map(th => th.innerText.trim()),
      editions: [...document.querySelectorAll('.mapping-sources + ul li, .mapping-sources ~ ul li')].map(li => li.innerText.trim()) })`);
    const expected = cats.filter((c) => c.flow === flow).flatMap((c) => c.accountRanges.map((a) => ({ label: c.label, from: a.from, to: a.to, fy: [a.fromFiscalYear, a.toFiscalYear] })));
    console.log(`== ${flow}: focus on #${r.focus}; table head ${JSON.stringify(r.head)}; ${r.rows.length} rows shown, ${expected.length} ranges in categories.json`);
    for (const row of r.rows) console.log('   ', row.join(' | ').slice(0, 190));
    const editionIds = [...new Set(cats.filter((c) => c.flow === flow).flatMap((c) => c.accountRanges.flatMap((a) => a.sourceIds)))];
    console.log(`   editions on page: ${r.editions.length}; cited in categories.json for ${flow}: ${editionIds.map((id) => sources[id]?.title.slice(0, 50)).join(' / ')}`);
    for (const e of r.editions) console.log('     -', e.slice(0, 150));
    await page.close();
  }
} finally {
  browser.close();
}
