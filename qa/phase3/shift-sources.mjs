// QA P3-10: which elements move in a layout shift during a throttled phone load (Slow 4G, 4x CPU).
// Records every layout-shift entry with its sources (element, previous and current rect).
// Usage: node qa/phase3/shift-sources.mjs <base> <out dir> '<json [{name, query, width, height, dark}]>'
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out, json] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-shift`, port: 9386 });
const REC = `window.__shifts = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), input: e.hadRecentInput,
  src: e.sources.map(s => { const n = s.node; const d = n && n.nodeType === 1 ? n : n?.parentElement;
    return { node: d ? d.tagName.toLowerCase() + (d.id ? '#' + d.id : '') + (d.className && typeof d.className === 'string' ? '.' + d.className.trim().split(/\\s+/).join('.') : '') + ' "' + (d.innerText || '').slice(0, 40).replace(/\\s+/g, ' ') + '"' : String(n),
      prev: [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round), cur: [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round) }; }) }); }).observe({ type: 'layout-shift', buffered: true });
  window.__fonts = []; document.fonts?.addEventListener?.('loadingdone', (e) => window.__fonts.push([Math.round(performance.now()), e.fontfaces.map(f => f.family + ' ' + f.weight).join(', ')]));`;
try {
  for (const c of JSON.parse(json)) {
    const page = await newPage(browser.port);
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (675 * 1024) / 8 * 0.9 });
    await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: REC });
    await page.viewport(c.width, c.height, { mobile: true, dark: !!c.dark, scale: 3 });
    await page.goto(`${base}/${c.query}`, 3000);
    const r = await page.eval('({ shifts: window.__shifts, fonts: window.__fonts })');
    console.log(`== ${c.name}: fonts ${JSON.stringify(r.fonts)}`);
    for (const s of r.shifts) {
      console.log(`  t=${s.t} value=${s.v} input=${s.input}`);
      for (const x of s.src) console.log(`     ${x.node}  ${JSON.stringify(x.prev)} -> ${JSON.stringify(x.cur)}`);
    }
    await page.close();
  }
} finally {
  browser.close();
}
