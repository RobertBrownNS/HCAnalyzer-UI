// QA P4a-06: which elements move in the post-load layout shift? Records layout-shift entries with
// their sources (node description, previous and current rects).
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out, query = '?flow=revenue'] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-shift`, port: 9362 });
const REC = `(() => { window.__shifts = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) {
  if (e.hadRecentInput) continue;
  window.__shifts.push({ t: Math.round(e.startTime), v: +e.value.toFixed(4), sources: (e.sources || []).map((s) => {
    const n = s.node; const desc = n ? (n.nodeType === 1 ? n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').join('.') : '') : '#text:' + (n.textContent || '').slice(0, 30)) : '(gone)';
    const r = (x) => [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)];
    return { node: desc, parent: n && n.parentElement ? n.parentElement.tagName.toLowerCase() + '.' + String(n.parentElement.className).split(' ')[0] : null, from: r(s.previousRect), to: r(s.currentRect) }; }) }); } })
  .observe({ type: 'layout-shift', buffered: true }); })();`;
try {
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: REC });
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.send('Page.navigate', { url: `${base}/${query}` });
  await sleep(6000);
  console.log(JSON.stringify(await page.eval('window.__shifts'), null, 1));
} finally {
  browser.close();
}
