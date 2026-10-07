// QA P2-12: load scenarios in headless Chrome and dump what is on screen.
// Usage: node qa/phase2/probe.mjs <baseUrl> <outDir> '<json array of scenarios>'
// Scenario: { name, query, width, height, mobile, dark, table, shot }
import { launch, newPage, sleep } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, outDir, json] = process.argv.slice(2);
const scenarios = JSON.parse(json);
mkdirSync(outDir, { recursive: true });

const COLLECT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const txt = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : null;
  const kpis = [...document.querySelectorAll('app-kpi-row')].filter(vis).map((row) =>
    [...row.querySelectorAll('li')].map((li) => ({ label: txt(li.querySelector('.label')), value: txt(li.querySelector('.value')), sub: txt(li.querySelector('.sub')),
      border: getComputedStyle(li).borderTopColor, valueColor: getComputedStyle(li.querySelector('.value')).color })));
  const interactive = [...document.querySelectorAll('button, a[href], input, select, [role=button], [role=slider], [tabindex]:not([tabindex="-1"]), summary')].filter(vis);
  const small = interactive.map((el) => { const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), cls: el.className && el.className.baseVal === undefined ? String(el.className).slice(0, 40) : '', name: (el.getAttribute('aria-label') || txt(el) || el.type || '').slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w < 44 || x.h < 44);
  const table = [...document.querySelectorAll('app-series-table table')].map((t) => ({
    caption: txt(t.querySelector('caption')),
    head: [...t.querySelectorAll('thead th')].map(txt),
    rows: [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map(txt)) }))[0] ?? null;
  return {
    search: location.search,
    title: txt(document.querySelector('#chart-title')),
    captions: [...document.querySelectorAll('.chart-tile .meta')].map(txt),
    chips: [...document.querySelectorAll('.chips button')].filter(vis).map((b) => ({ text: txt(b), aria: b.getAttribute('aria-label') })),
    kpis,
    chartAria: document.querySelector('app-series-chart [role=img]')?.getAttribute('aria-label') ?? null,
    notes: [...document.querySelectorAll('app-view-notes li')].map(txt),
    source: txt(document.querySelector('.chart-tile .source')),
    table,
    overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    small,
    filtersVisible: vis(document.querySelector('aside.filters') || document.body) && !!document.querySelector('aside.filters'),
    filtersRect: (() => { const a = document.querySelector('aside.filters'); if (!a) return null; const r = a.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; })(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
})()`;

const browser = await launch({ profile: `${outDir}/profile` });
const results = {};
try {
  for (const sc of scenarios) {
    const page = await newPage(browser.port);
    await page.viewport(sc.width ?? 1440, sc.height ?? 900, { mobile: !!sc.mobile, dark: !!sc.dark });
    await page.goto(`${base}/${sc.query ?? ''}`);
    if (sc.table) {
      await page.eval(`[...document.querySelectorAll('.chart-tile button')].find(b => /table/i.test(b.textContent)).click()`);
      await sleep(600);
    }
    const r = await page.eval(COLLECT);
    r.requests = [...new Set(page.requests.map((u) => new URL(u).origin))];
    r.console = page.console;
    if (sc.shot) await page.shot(`${outDir}/${sc.name}.png`, sc.full);
    results[sc.name] = r;
    page.close();
  }
} finally {
  browser.close();
}
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
