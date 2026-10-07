// QA P3-09/10: where is the QA-07 "what all funds includes" text shown? Desktop and phone, default
// scope and a preset. Text processing happens in Node (no regex inside page.eval strings).
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-qa07`, port: 9373 });
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const texts = (page, sel) => page.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => e.getBoundingClientRect().height > 0).map(e => e.innerText)`);
const pick = (arr) => arr.map(squash).filter((t) => /Includes|All funds|Governmental funds|General Fund|Custom selection/.test(t)).map((t) => t.slice(0, 240));
try {
  for (const [q, w, mobile] of [['?county=hillsborough', 1440, false], ['?county=pinellas&chart=stacked', 1440, false], ['?county=pinellas&funds=general', 1440, false], ['?county=pinellas', 390, true]]) {
    const page = await newPage(browser.port);
    await page.viewport(w, 900, { mobile });
    await page.goto(`${base}/${q}`);
    console.log('==', q, w);
    console.log('  chart caption:', JSON.stringify(pick(await texts(page, '.chart-tile .meta'))));
    console.log('  filters pane :', JSON.stringify(pick(await texts(page, 'aside .hint'))));
    console.log('  methodology  :', JSON.stringify(pick(await texts(page, 'app-methodology dd'))));
    if (mobile) {
      console.log('  chips        :', JSON.stringify((await texts(page, '.chips button')).map(squash)));
      await page.eval(`[...document.querySelectorAll('.chips button')].find(b => b.textContent.includes('funds') || b.textContent.includes('Fund'))?.click()`);
      await sleep(800);
      console.log('  funds sheet  :', JSON.stringify(pick(await texts(page, '.mat-bottom-sheet-container .hint'))));
    }
    await page.close();
  }
} finally {
  browser.close();
}
