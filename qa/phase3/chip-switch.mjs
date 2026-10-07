// QA-47: phone chips across a county switch. Loads at 390 px (Slow 4G, 4x CPU), records the chip
// labels, switches county from the County sheet, then records the chips again during and after
// the switch (sampled every animation frame), plus any layout shift after the switch.
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-chipswitch`, port: 9388 });
const chips = `[...document.querySelectorAll('.chips > *')].map(b => b.innerText.trim() + (b.classList.contains('fx-chip') ? '' : ' [' + b.className + ']'))`;
try {
  const page = await newPage(browser.port);
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (675 * 1024) / 8 * 0.9 });
  await page.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.viewport(390, 844, { mobile: true, scale: 2 });
  await page.goto(`${base}/`, 3000);
  console.log('before:', JSON.stringify(await page.eval(chips)));
  await page.eval(`[...document.querySelectorAll('.chips button')].find(b => b.innerText.startsWith('County')).click()`);
  await sleep(1200);
  const sheet = await page.eval(`(() => { const s = document.querySelector('.cdk-overlay-container'); const sel = s.querySelector('select'); return sel ? 'select:' + [...sel.options].map(o => o.value).join(',') : [...s.querySelectorAll('button, [role=radio], input')].map(e => e.innerText || e.value).join('|'); })()`);
  console.log('sheet:', sheet);
  await page.eval(`window.__shifts = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push([Math.round(e.startTime), +e.value.toFixed(4), e.hadRecentInput, e.sources.map(s => { const d = s.node?.nodeType === 1 ? s.node : s.node?.parentElement; return (d ? d.tagName.toLowerCase() + '.' + String(d.className).trim().split(/\s+/).join('.') + ' "' + (d.innerText || '').slice(0, 30) + '"' : '?') + ' ' + JSON.stringify([s.previousRect.x, s.previousRect.y, s.previousRect.width, s.currentRect.x, s.currentRect.y, s.currentRect.width].map(Math.round)); })]); }).observe({ type: 'layout-shift' });
    window.__chipLog = []; (function tick() { const v = ${chips}.join(' | '); if (window.__chipLog.at(-1)?.[1] !== v) window.__chipLog.push([Math.round(performance.now()), v]); if (window.__chipLog.length < 50) requestAnimationFrame(tick); })();`);
  await page.eval(`(() => { const s = document.querySelector('.cdk-overlay-container'); const sel = s.querySelector('select');
    if (sel) { sel.value = 'pinellas'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    else [...s.querySelectorAll('button, label')].find(e => /Pinellas/.test(e.innerText)).click(); })()`);
  await sleep(500);
  await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(9000);
  const r = await page.eval(`({ log: window.__chipLog, shifts: window.__shifts, url: location.search })`);
  console.log('url:', r.url);
  for (const [t, v] of r.log) console.log(`  t=${t}: ${v}`);
  console.log('shifts after switch:', JSON.stringify(r.shifts));
  await page.close();
} finally {
  browser.close();
}
