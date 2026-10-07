// QA P2-12: Auto/Light/Dark override: cycle, persistence across reload, chart re-theme, phone header fit.
import { launch, newPage, sleep } from './cdp.mjs';
const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-theme`, port: 9346 });
const snap = (p) => p.eval(`(() => { const b = [...document.querySelectorAll('header button')].find(x => /Auto|Light|Dark/.test(x.textContent));
  const host = document.querySelector('app-series-chart'); const probe = document.createElement('span'); host.appendChild(probe); probe.style.color = 'var(--fx-color-text-faint)'; const faint = getComputedStyle(probe).color; probe.remove();
  let stored = null; try { stored = localStorage.getItem('fx-color-scheme'); } catch {}
  const r = b.getBoundingClientRect();
  return { button: b.textContent.trim(), aria: b.getAttribute('aria-label'), dataTheme: document.documentElement.getAttribute('data-theme'), bodyBg: getComputedStyle(document.body).backgroundColor,
    tile: getComputedStyle(document.querySelector('.fx-tile')).backgroundColor, faint, stored, btn: [Math.round(r.width), Math.round(r.height)],
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
const click = (p) => p.eval(`[...document.querySelectorAll('header button')].find(x => /Auto|Light|Dark/.test(x.textContent)).click()`);
try {
  for (const [w, h, mobile, sysDark] of [[1440, 900, false, false], [390, 844, true, true]]) {
    const page = await newPage(browser.port);
    await page.viewport(w, h, { mobile, dark: sysDark });
    await page.goto(`${base}/?flow=expenditure`);
    await page.eval(`localStorage.clear()`); await page.goto(`${base}/?flow=expenditure`);
    console.log(`== ${w}px system ${sysDark ? 'dark' : 'light'}`);
    console.log('  start ', JSON.stringify(await snap(page)));
    for (let i = 0; i < 3; i++) { await click(page); await sleep(500); console.log('  click ', JSON.stringify(await snap(page))); if (i === 1) await page.shot(`${out}/theme-${w}-${i}.png`); }
    await click(page); await sleep(300); // -> Light (mode after 4 clicks: light)
    await page.goto(`${base}/?flow=expenditure`);
    console.log('  reload', JSON.stringify(await snap(page)));
    page.close();
  }
} finally { browser.close(); }
