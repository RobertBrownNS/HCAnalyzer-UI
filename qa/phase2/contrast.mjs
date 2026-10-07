// QA P2-12: WCAG contrast of every rendered text node (light and dark), plus focus ring vs background.
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
const SCAN = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
    let col = { r: 255, g: 255, b: 255, a: 1 }; for (const c of stack.reverse()) col = blend(c, col); return col; };
  const seen = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const t = n.textContent.trim(); if (!t) continue;
    const el = n.parentElement; const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || el.closest('.sr-only,[aria-hidden=true]')) continue;
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); const c = ratio(blend(fg, bg), bg);
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = el.closest('button:disabled, select:disabled, [aria-disabled=true]') ? 0 : large ? 3 : 4.5;
    const key = cs.color + '|' + bg.r + ',' + bg.g + ',' + bg.b + '|' + size;
    if (!seen.has(key)) seen.set(key, { ratio: +c.toFixed(2), need, color: cs.color, bg: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round) + ')', size, sample: t.slice(0, 40), tag: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] });
  }
  return [...seen.values()].sort((a, b) => a.ratio - b.ratio);
})()`;

const browser = await launch({ profile: `${out}/profile-contrast`, port: 9336 });
try {
  for (const [label, w, h, mobile] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
    for (const dark of [false, true]) {
      const page = await newPage(browser.port);
      await page.viewport(w, h, { mobile, dark });
      await page.goto(`${base}/?flow=revenue&measure=real&cpi=cpi-u-tampa`);
      // Expand caveat <details> so their text is scanned too.
      await page.eval(`document.querySelectorAll('details').forEach(d => d.open = true)`);
      await sleep(300);
      const rows = await page.eval(SCAN);
      const fails = rows.filter((r) => r.ratio < r.need);
      console.log(`== ${label} ${dark ? 'dark' : 'light'}: ${rows.length} color/background/size combos, ${fails.length} below AA; lowest 4:`);
      for (const r of rows.slice(0, 4)) console.log('   ', JSON.stringify(r));
      for (const r of fails) console.log('   FAIL', JSON.stringify(r));
      // Focus ring contrast against the surface around the focused control (WCAG 1.4.11: 3:1).
      const ring = await page.eval(`(() => { const b = document.querySelector('.chart-tile button'); b.focus(); const cs = getComputedStyle(b); return { outline: cs.outlineColor, bg: getComputedStyle(b.closest('.fx-tile')).backgroundColor }; })()`);
      console.log('    focus ring', JSON.stringify(ring));
      page.close();
    }
  }
} finally {
  browser.close();
}
