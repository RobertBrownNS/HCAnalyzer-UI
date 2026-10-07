// QA P2-15: while the chart skeleton is showing (ECharts chunk held by the server), check the shimmer
// under normal and reduced motion, and the skeleton colors against the tile in light and dark.
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-skelstyle`, port: 9354 });
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = rgb; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const ratio = (a, b) => { const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p); return ((x + 0.05) / (y + 0.05)).toFixed(2); };
try {
  for (const dark of [false, true]) {
    for (const reduce of [false, true]) {
      const page = await newPage(browser.port);
      await page.viewport(390, 844, { mobile: true, dark });
      await page.send('Emulation.setEmulatedMedia', { features: [
        { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
        { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
      await page.send('Page.navigate', { url: `${base}/?flow=expenditure` });
      await sleep(2500);
      const s = await page.eval(`(() => { const el = [...document.querySelectorAll('app-chart-skeleton .fx-skel')].find(e => !e.closest('.fx-skel-pending'));
        if (!el) return null; const a = getComputedStyle(el, '::after'); const tile = getComputedStyle(el.closest('.fx-tile') || document.body).backgroundColor;
        return { base: getComputedStyle(el).backgroundColor, tile, afterDisplay: a.display, animation: a.animationName, duration: a.animationDuration,
          hostAriaHidden: el.closest('app-chart-skeleton').getAttribute('aria-hidden') }; })()`);
      if (s) s.baseVsTile = ratio(s.base, s.tile);
      console.log(`${dark ? 'dark ' : 'light'} reduce=${reduce}:`, JSON.stringify(s));
      if (!reduce) await page.shot(`${out}/skeleton-${dark ? 'dark' : 'light'}.png`);
      page.close();
    }
  }
} finally {
  browser.close();
}
