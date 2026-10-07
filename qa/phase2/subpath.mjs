// QA P2-14: under a sub-path, do entry, deep links, mistyped paths and reloads work, and do all
// requests stay under the sub-path? Pairs with pages-server.mjs.
import { launch, newPage, sleep } from './cdp.mjs';

const [origin, sub, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-subpath`, port: 9350 });
const view = (p) => p.eval(`({ href: location.href, kpi: document.querySelector('app-kpi-row li .value')?.textContent.trim() ?? null,
  title: document.querySelector('#chart-title')?.textContent.replace(/\\s+/g, ' ').trim() ?? null,
  alert: document.querySelector('[role=alert]')?.innerText ?? null,
  measure: document.querySelectorAll('aside select')[1]?.value ?? null })`);
const cases = [
  ['entry with slash', `${sub}`],
  ['entry without slash', `${sub.slice(0, -1)}`],
  ['shared link with params', `${sub}?flow=expenditure&measure=per_capita&from=2015&to=2025`],
  ['deep path, no params', `${sub}some/deep/path`],
  ['deep path with params', `${sub}some/deep/path?flow=expenditure&measure=real&cpi=cpi-u-tampa&cpiper=calendar`],
  ['mistyped file', `${sub}index.htm`],
  ['index.html explicitly', `${sub}index.html?flow=expenditure`],
];
try {
  for (const [name, path] of cases) {
    const page = await newPage(browser.port);
    await page.viewport(1440, 900);
    await page.goto(origin + path, 2000);
    const v = await view(page);
    const outside = page.requests.filter((u) => !u.startsWith(origin + sub) && !u.startsWith('data:') && !u.startsWith('about:'));
    console.log(`${name.padEnd(26)} -> ${v.href.replace(origin, '')}`);
    console.log(`${''.padEnd(29)}kpi=${v.kpi} measure=${v.measure} alert=${v.alert} | requests outside sub-path: ${JSON.stringify(outside)} | console: ${JSON.stringify(page.console)}`);
    if (name === 'shared link with params') {
      // Change a setting, then reload: the view must come back from the URL.
      await page.eval(`(() => { const s = document.querySelectorAll('aside select')[1]; s.value = 'real'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(800);
      const before = await view(page);
      await page.send('Page.reload', { ignoreCache: true });
      await sleep(3000);
      const after = await view(page);
      console.log(`${''.padEnd(29)}reload: url same=${before.href === after.href} measure ${before.measure}->${after.measure} kpi ${before.kpi}->${after.kpi}`);
    }
    page.close();
  }
} finally {
  browser.close();
}
