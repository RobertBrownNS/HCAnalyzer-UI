// QA P4a-06: county switch. Lazy load (Pinellas observations fetched only when selected), what the
// KPI shows during a slow switch (never the previous county's value), skeletons, history (Back/Forward),
// and that switching back uses the cached county (no refetch).
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-switch`, port: 9361 });
const SLOW = { latency: 562.5, downloadThroughput: ((1.44 * 1024 * 1024) / 8) * 0.9, uploadThroughput: ((675 * 1024) / 8) * 0.9 };
try {
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.goto(`${base}/?flow=revenue`);
  const obsRequests = () => page.requests.filter((u) => u.includes('.observations.json')).map((u) => new URL(u).pathname.split('/').pop());
  const state = () => page.eval(`({ url: location.search, hist: history.length, title: document.querySelector('#chart-title')?.textContent.replace(/\\s+/g, ' ').trim(),
    kpi: document.querySelector('app-kpi-row li .value')?.textContent.trim() ?? null, busy: document.querySelector('.main')?.getAttribute('aria-busy'),
    skel: [...document.querySelectorAll('.fx-skel')].filter(e => !e.closest('.fx-skel-pending') && e.getBoundingClientRect().height > 0).length,
    header: document.querySelector('header')?.innerText.replace(/\\s+/g, ' ').trim(),
    docTitle: document.title })`);
  console.log('initial      ', JSON.stringify(await state()), '| observations fetched:', obsRequests());

  // Slow network for the switch, so any stale value or skeleton is visible.
  await page.send('Network.emulateNetworkConditions', { offline: false, ...SLOW });
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.eval(`(() => { const s = [...document.querySelectorAll('aside select')].find(x => [...x.options].some(o => o.value === 'pinellas')); s.value = 'pinellas'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const seen = [];
  for (let i = 0; i < 80; i++) {
    const s = await state();
    const key = `${s.title} | kpi=${s.kpi} | busy=${s.busy} | skel=${s.skel}`;
    if (!seen.length || seen.at(-1)[1] !== key) seen.push([i * 50, key]);
    if (s.kpi && s.kpi !== '—' && s.title?.startsWith('Pinellas') && s.busy === 'false') break;
    await sleep(50);
  }
  console.log('during switch (ms since change ≈ index×50):');
  for (const [t, k] of seen) console.log('   ', t, k);
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(500);
  console.log('after switch ', JSON.stringify(await state()), '| observations fetched:', obsRequests());

  const before = obsRequests().length;
  await page.eval('history.back()'); await sleep(1500);
  console.log('after Back   ', JSON.stringify(await state()));
  await page.eval('history.forward()'); await sleep(1500);
  console.log('after Forward', JSON.stringify(await state()));
  console.log('extra observation fetches on Back/Forward (cache disabled at HTTP level, so >0 would mean the app refetched):', obsRequests().length - before);
} finally {
  browser.close();
}
