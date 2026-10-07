// QA P3-10: load views and dump what is on screen, including the full multi-series table.
// Usage: node qa/phase3/p3probe.mjs <baseUrl> <outDir> '<json array of {name, query, width?, height?, mobile?, dark?, table?, shot?}>'
import { launch, newPage, sleep } from '../phase2/cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, outDir, json] = process.argv.slice(2);
const scenarios = JSON.parse(json);
mkdirSync(outDir, { recursive: true });
const COLLECT = `(() => {
  const txt = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const tables = [...document.querySelectorAll('.chart-tile table')].filter(vis).map((t) => ({
    caption: txt(t.querySelector('caption')),
    head: [...t.querySelectorAll('thead th')].map(txt),
    rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(txt)) }));
  return {
    search: location.search,
    title: txt(document.querySelector('#chart-title')),
    captions: [...document.querySelectorAll('.chart-tile .meta, .chart-tile .fx-caption')].map(txt),
    chartType: document.querySelector('.chart-type select')?.value ?? null,
    kpis: [...document.querySelectorAll('app-kpi-row')].filter(vis).flatMap((row) => [...row.querySelectorAll('li')].map((li) => txt(li))),
    notes: [...document.querySelectorAll('app-view-notes li')].map(txt),
    tables,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    alert: txt(document.querySelector('[role=alert]')),
  };
})()`;
const browser = await launch({ profile: `${outDir}/profile-p3`, port: 9370 });
const results = {};
try {
  for (const sc of scenarios) {
    const page = await newPage(browser.port);
    await page.viewport(sc.width ?? 1440, sc.height ?? 900, { mobile: !!sc.mobile, dark: !!sc.dark });
    await page.goto(`${base}/${sc.query ?? ''}`);
    if (sc.table) {
      await page.eval(`[...document.querySelectorAll('.chart-tile button')].find(b => b.textContent.trim() === 'Table')?.click()`);
      await sleep(700);
    }
    const r = await page.eval(COLLECT);
    r.requests = [...new Set(page.requests.map((u) => new URL(u).origin))];
    r.console = page.console;
    if (sc.shot) await page.shot(`${outDir}/${sc.name}.png`);
    results[sc.name] = r;
    await page.close();
  }
} finally {
  browser.close();
}
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 1));
console.log('done', Object.keys(results).length);
