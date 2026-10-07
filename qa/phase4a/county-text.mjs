// QA P4a-06: on each county's views, collect every rendered string (expanded caveats, every bottom
// sheet, aria-labels, titles, document.title) and report (a) mentions of the other county,
// (b) comparison wording between counties, (c) loaded or editorial words.
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const COUNTIES = { hillsborough: 'pinellas', pinellas: 'hillsborough' };
const LOADED = /\b(soar\w*|skyrocket\w*|bloat\w*|slash\w*|surg\w*|plung\w*|explod\w*|balloon\w*|runaway|modest\w*|dramatic\w*|drastic\w*|massive\w*|sharp\w*|huge|alarming|staggering|wasteful|merely|actually|truth|myth|verdict|good|bad|healthy|worse|better|best|worst|troubling|impressive|excessive|reckless|irresponsible|amendment|ballot|vote|campaign)\b/gi;
const COMPARE = /\b(than (hillsborough|pinellas)|compared (to|with) (hillsborough|pinellas)|versus|vs\.?)\b/gi;
const views = ['', '&flow=expenditure&cust=1', '&measure=real_per_capita&cpi=cpi-u-tampa', '&flow=expenditure&xfer=net&idx=1'];
const browser = await launch({ profile: `${out}/profile-ctext`, port: 9360 });
try {
  for (const [county, other] of Object.entries(COUNTIES)) {
    const hits = new Map();
    for (const v of views) {
      for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
        const page = await newPage(browser.port);
        await page.viewport(w, h, { mobile });
        await page.goto(`${base}/?county=${county}${v}`);
        await page.eval(`document.querySelectorAll('details').forEach(d => d.open = true)`);
        let text = await page.eval('document.title + " | " + document.body.innerText');
        if (mobile) {
          const n = await page.eval(`document.querySelectorAll('.chips button').length`);
          for (let i = 0; i < n; i++) {
            await page.eval(`document.querySelectorAll('.chips button')[${i}].click()`);
            await sleep(500);
            text += ' | ' + await page.eval(`document.querySelector('.mat-bottom-sheet-container')?.innerText ?? ''`);
            await page.eval(`document.querySelector('.cdk-overlay-backdrop')?.click()`);
            await sleep(400);
          }
        }
        text += ' | ' + (await page.eval(`[...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || ''))`)).join(' | ');
        const add = (kind, re) => {
          for (const m of text.matchAll(re)) {
            const ctx = text.slice(Math.max(0, m.index - 70), m.index + 70).replace(/\s+/g, ' ');
            hits.set(`${kind} :: ${m[0]} :: ${ctx}`, true);
          }
        };
        add('OTHER-COUNTY', new RegExp(`\\b${other}\\b`, 'gi'));
        add('COMPARE', COMPARE);
        add('LOADED', LOADED);
        await page.close();
      }
    }
    console.log(`== ${county}: ${hits.size} distinct hits`);
    for (const k of hits.keys()) console.log('  ', k);
  }
} finally {
  browser.close();
}
