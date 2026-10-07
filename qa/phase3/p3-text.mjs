// QA P3-10: neutrality sweep of Phase 3 surfaces. For each county x chart type (and a preset), the
// rendered page text plus aria/title text, one source drawer, and the category-mapping view are
// searched for ranking or loaded words. Matching happens in Node.
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const WORDS = /\b(largest|biggest|smallest|top|leading|most|least|highest|lowest|rank\w*|dominant|dominat\w*|majority|minority|soar\w*|skyrocket\w*|bloat\w*|slash\w*|surg\w*|plung\w*|explod\w*|balloon\w*|runaway|modest\w*|dramatic\w*|drastic\w*|massive\w*|sharp\w*|huge|alarming|staggering|wasteful|merely|actually|truth|myth|verdict|good|bad|healthy|worse|better|best|worst|troubling|impressive|excessive|reckless|irresponsible|amendment|ballot|vote|campaign)\b/gi;
const browser = await launch({ profile: `${out}/profile-p3text`, port: 9375 });
const hits = new Map();
const scan = (where, text) => {
  for (const m of text.matchAll(WORDS)) {
    const ctx = text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ');
    hits.set(`${m[0]} :: ${ctx}`, where);
  }
};
try {
  for (const county of ['hillsborough', 'pinellas']) {
    for (const chart of ['line', 'lines', 'stacked', 'share', 'bars']) {
      for (const extra of ['', '&flow=expenditure&funds=general']) {
        const page = await newPage(browser.port);
        await page.viewport(1440, 900);
        await page.goto(`${base}/?county=${county}&chart=${chart}${extra}`);
        await page.eval(`document.querySelectorAll('details').forEach(d => d.open = true)`);
        let text = await page.eval('document.title + " | " + document.body.innerText');
        text += ' | ' + (await page.eval(`[...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || ''))`)).join(' | ');
        scan(`${county} ${chart}${extra}`, text);
        if (chart === 'stacked' && !extra) {
          // A source drawer, and the category-mapping view.
          await page.eval(`[...document.querySelectorAll('.chart-tile button')].find(b => b.textContent.trim() === 'Table')?.click()`);
          await sleep(600);
          await page.eval(`document.querySelector('.chart-tile table tbody tr td button')?.click()`);
          await sleep(800);
          scan(`${county} drawer`, await page.eval(`document.querySelector('.cdk-overlay-container')?.innerText ?? ''`));
          await page.eval(`document.querySelector('.cdk-overlay-container app-source-drawer button.close')?.click()`);
          await sleep(500);
          await page.eval(`[...document.querySelectorAll('aside button')].find(b => b.textContent.includes('How account codes map'))?.click()`);
          await sleep(800);
          const mapping = await page.eval(`document.querySelector('.cdk-overlay-container')?.innerText ?? ''`);
          console.log(`${county} mapping view: ${mapping.length} chars; first line: ${mapping.split('\n').find((l) => l.trim())?.slice(0, 80)}`);
          scan(`${county} mapping`, mapping);
        }
        await page.close();
      }
    }
  }
} finally {
  browser.close();
}
console.log(`${hits.size} distinct hits`);
for (const [k, where] of hits) console.log(`  [${where}] ${k}`);
