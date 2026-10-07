// QA P2-12: contrast of chart canvas colors (axis labels, annotation labels, series, markLines) vs tile.
import { launch, newPage } from './cdp.mjs';
const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-canvas`, port: 9337 });
const EXPR = `(() => {
  const host = document.querySelector('app-series-chart');
  const probe = document.createElement('span'); host.appendChild(probe);
  const res = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
  const names = ['--fx-color-text','--fx-color-text-muted','--fx-color-text-faint','--fx-color-tile','--fx-series-1','--fx-series-2','--fx-annotation-methodology','--fx-color-axis-line','--fx-color-gridline','--fx-type-axis-size','--fx-type-label-small-size'];
  const o = {}; for (const n of names) o[n] = n.includes('size') ? getComputedStyle(host).getPropertyValue(n).trim() : res('var(' + n + ')');
  probe.remove(); return o; })()`;
const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
const lum = (rgb) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; const [r, g, b] = rgb.map(f); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(parse(a)), lum(parse(b))].sort((p, q) => q - p); return ((x + 0.05) / (y + 0.05)).toFixed(2); };
try {
  for (const dark of [false, true]) {
    const page = await newPage(browser.port);
    await page.viewport(1440, 900, { dark });
    await page.goto(`${base}/?flow=expenditure`);
    const c = await page.eval(EXPR);
    const bg = c['--fx-color-tile'];
    console.log(dark ? 'DARK' : 'LIGHT', 'tile', bg, 'axis font', c['--fx-type-axis-size'], 'label font', c['--fx-type-label-small-size']);
    for (const k of ['--fx-color-text-faint', '--fx-color-text-muted', '--fx-series-1', '--fx-series-2', '--fx-annotation-methodology', '--fx-color-axis-line', '--fx-color-gridline'])
      console.log('  ', k.padEnd(28), c[k].padEnd(22), ratio(c[k], bg));
    page.close();
  }
} finally { browser.close(); }
