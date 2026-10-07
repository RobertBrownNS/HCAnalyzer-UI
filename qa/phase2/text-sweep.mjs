// QA P2-12: grep all rendered text (incl. expanded caveats and every sheet) for editorial language.
import { launch, newPage, sleep } from './cdp.mjs';
const [base, out] = process.argv.slice(2);
const WORDS = /\b(soar\w*|skyrocket\w*|bloat\w*|slash\w*|surg\w*|plung\w*|explod\w*|balloon\w*|runaway|modest\w*|dramatic\w*|drastic\w*|massive\w*|sharp\w*|huge|alarming|staggering|wasteful|spree|merely|just|actually|truth|myth|verdict|good|bad|healthy|worse|better|best|worst|concern\w*|troubling|impressive|excessive|reckless|responsible|irresponsible|amendment|ballot|vote|campaign|league of cities|policy institute|taxwatch|doge|win\w*|los(e|ing|s))\b/gi;
const browser = await launch({ profile: `${out}/profile-text`, port: 9342 });
const hits = new Map();
try {
  const views = ['?flow=revenue', '?flow=expenditure&cust=1&measure=real_per_capita&cpi=cpi-u-tampa', '?flow=expenditure&xfer=net&idx=1', '?flow=revenue&measure=per_capita&cust=1'];
  for (const v of views) {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const page = await newPage(browser.port);
      await page.viewport(w, h, { mobile });
      await page.goto(`${base}/${v}`);
      await page.eval(`document.querySelectorAll('details').forEach(d => d.open = true)`);
      let text = await page.eval('document.body.innerText');
      if (mobile) {
        const n = await page.eval(`document.querySelectorAll('.chips button').length`);
        for (let i = 0; i < n; i++) { await page.eval(`document.querySelectorAll('.chips button')[${i}].click()`); await sleep(500);
          text += '\n' + await page.eval(`document.querySelector('.mat-bottom-sheet-container')?.innerText ?? ''`);
          await page.eval(`document.querySelector('.cdk-overlay-backdrop')?.click()`); await sleep(400); }
      }
      text += '\n' + await page.eval(`[...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label')||'') + ' ' + (e.getAttribute('title')||'')).join(' | ')`);
      for (const m of text.matchAll(WORDS)) {
        const i = m.index; const ctx = text.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ');
        hits.set(m[0].toLowerCase() + ' :: ' + ctx, (hits.get(m[0].toLowerCase() + ' :: ' + ctx) ?? 0) + 1);
      }
      page.close();
    }
  }
} finally { browser.close(); }
for (const [k] of hits) console.log(k);
console.log(hits.size, 'distinct hits');
