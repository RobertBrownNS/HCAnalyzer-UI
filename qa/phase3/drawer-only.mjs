// QA P3-10 (DR-50 drawerOnly, 83e9646): reconciliation notes on chart surfaces. For each view, the
// chart key under the chart and the "Notes for this view" list are searched for the note's label.
// A drawer-only note must appear in neither; a chart-scoped note still must where its scope applies.
import { launch, newPage } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const PIN = '335.8';
const HIL = '559';
const views = [
  ['pinellas', 'revenue', '', PIN],
  ['pinellas', 'revenue', '&funds=special_revenue', PIN],
  ['pinellas', 'revenue', '&chart=lines', PIN],
  ['pinellas', 'revenue', '&chart=lines&cats=intergovernmental', PIN],
  ['pinellas', 'revenue', '&chart=stacked', PIN],
  ['pinellas', 'revenue', '&chart=share&funds=special_revenue', PIN],
  ['pinellas', 'revenue', '&chart=bars&cats=intergovernmental', PIN],
  ['pinellas', 'revenue', '&measure=per_capita_real&chart=stacked&cats=intergovernmental', PIN],
  ['hillsborough', 'expenditure', '', HIL],
  ['hillsborough', 'expenditure', '&funds=internal_service', HIL],
  ['hillsborough', 'expenditure', '&funds=component_unit', HIL],
  ['hillsborough', 'expenditure', '&funds=general', HIL],
  ['hillsborough', 'expenditure', '&chart=stacked&funds=internal_service', HIL],
];
const browser = await launch({ profile: `${out}/profile-drawer-only`, port: 9378 });
try {
  for (const [county, flow, extra, code] of views) {
    const page = await newPage(browser.port);
    await page.viewport(1440, 900);
    await page.goto(`${base}/?county=${county}&flow=${flow}&from=2010&to=2018${extra}`);
    const r = await page.eval(`({ key: document.querySelector('.chart-key')?.innerText ?? '',
      notes: [...document.querySelectorAll('app-view-notes li')].map(li => li.innerText) })`);
    const hit = (t) => t.includes(`account ${code}`) || t.includes(` ${code} `);
    const inKey = hit(r.key);
    const inNotes = r.notes.filter(hit).length;
    console.log(`${county} ${flow}${extra}`.padEnd(80), `key:${inKey} notes:${inNotes}`, inKey || inNotes ? '| ' + (r.notes.find(hit) ?? r.key).replace(/\s+/g, ' ').slice(0, 110) : '');
    await page.close();
  }
} finally {
  browser.close();
}
