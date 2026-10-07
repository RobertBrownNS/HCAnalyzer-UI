// QA P2-15: skeleton behaviour under throttled loads, measured independently of FE's script.
// Injects a per-frame recorder before the app starts, then reports: performance marks
// (fx:dataReady, fx:chartInit), when skeleton shapes first became visible, CLS, aria-busy and
// live-region transitions, what the chart area showed between data-ready and chart-init,
// and how many times the ECharts chunk was fetched.
// Usage: node qa/phase2/load-probe.mjs <baseUrl> <outDir> '<json scenarios>'
// Scenario: { name, query, width, height, mobile, dark, net: 'none'|'fast4g'|'slow4g', cpu, reducedMotion,
//             failData: 'cpi404'|'schema99', failDelayMs, shotAtMs }
import { launch, newPage, sleep } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const [base, outDir, json] = process.argv.slice(2);
const scenarios = JSON.parse(json);
mkdirSync(outDir, { recursive: true });

// DevTools presets (Chrome 2024+): "Fast 4G" and "Slow 4G" (the former "Fast 3G").
const NET = {
  none: null,
  fast4g: { latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
  slow4g: { latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (675 * 1024) / 8 * 0.9 },
};

const RECORDER = `(() => {
  const q = window.__qa = { frames: [], cls: 0, shifts: [], live: [], marks: {} };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { q.cls += e.value; q.shifts.push([Math.round(e.startTime), +e.value.toFixed(4)]); } })
      .observe({ type: 'layout-shift', buffered: true });
  } catch {}
  const visible = (el) => { if (el.closest('.fx-skel-pending')) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility === 'visible' && cs.display !== 'none'; };
  let lastLive = null;
  const tick = () => {
    const t = Math.round(performance.now());
    const skels = [...document.querySelectorAll('.fx-skel')].filter(visible);
    const fig = document.querySelector('.chart-tile .figure');
    const chartSkel = fig ? [...fig.querySelectorAll('app-chart-skeleton')].some((s) => !s.classList.contains('fx-skel-pending') && s.getBoundingClientRect().height > 0) : false;
    const canvas = !!(fig && fig.querySelector('app-series-chart canvas'));
    const main = document.querySelector('.main');
    const liveEl = main && main.querySelector(':scope > [aria-live]');
    const live = liveEl ? liveEl.textContent.trim() : null;
    if (live !== lastLive) { q.live.push([t, live]); lastLive = live; }
    q.frames.push([t, skels.length, chartSkel ? 1 : 0, canvas ? 1 : 0, main ? main.getAttribute('aria-busy') : null, !!document.querySelector('[role=alert]')]);
    if (q.frames.length < 4000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

const browser = await launch({ profile: `${outDir}/profile-load`, port: 9352 });
const results = {};
try {
  for (const sc of scenarios) {
    const page = await newPage(browser.port);
    await page.viewport(sc.width ?? 390, sc.height ?? 844, { mobile: sc.mobile ?? true, dark: !!sc.dark });
    const features = [{ name: 'prefers-color-scheme', value: sc.dark ? 'dark' : 'light' }];
    if (sc.reducedMotion) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
    await page.send('Emulation.setEmulatedMedia', { features });
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    const net = NET[sc.net ?? 'none'];
    if (net) await page.send('Network.emulateNetworkConditions', { offline: false, ...net });
    if (sc.cpu) await page.send('Emulation.setCPUThrottlingRate', { rate: sc.cpu });
    if (sc.failData) {
      await page.send('Fetch.enable', { patterns: [{ urlPattern: '*assets/data/*', requestStage: 'Request' }] });
      page.on(async (m) => {
        if (m.method !== 'Fetch.requestPaused') return;
        const { requestId, request } = m.params;
        const hit = sc.failData === 'cpi404' ? request.url.includes('cpi.json') : request.url.includes('manifest.json');
        if (!hit) return page.send('Fetch.continueRequest', { requestId });
        await sleep(sc.failDelayMs ?? 1500);
        if (sc.failData === 'cpi404') return page.send('Fetch.fulfillRequest', { requestId, responseCode: 404, body: Buffer.from('nf').toString('base64') });
        const real = await (await fetch(request.url)).json();
        real.schemaVersion = 99;
        return page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(real)).toString('base64') });
      });
    }
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
    await page.send('Page.navigate', { url: `${base}/${sc.query ?? '?flow=revenue'}` });
    if (sc.shotAtMs) { await sleep(sc.shotAtMs); await page.shot(`${outDir}/${sc.name}-at${sc.shotAtMs}.png`); }
    // Wait for chart init or an error, up to 60 s.
    for (let i = 0; i < 240; i++) {
      await sleep(250);
      const done = await page.eval(`!!performance.getEntriesByName('fx:chartInit').length || !!document.querySelector('[role=alert]')`).catch(() => false);
      if (done) break;
    }
    await sleep(1200);
    const r = await page.eval(`(() => { const q = window.__qa; const m = (n) => { const e = performance.getEntriesByName(n)[0]; return e ? Math.round(e.startTime) : null; };
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const skelAfter = [...document.querySelectorAll('.fx-skel')].filter(el => !el.closest('.fx-skel-pending') && el.getBoundingClientRect().height > 0).length;
      const after = getComputedStyle(document.querySelector('.fx-skel') || document.body, '::after');
      return { dataReady: m('fx:dataReady'), chartInit: m('fx:chartInit'), fcp: fcp ? Math.round(fcp.startTime) : null,
        cls: +q.cls.toFixed(4), shifts: q.shifts, live: q.live, frames: q.frames,
        busyAtEnd: document.querySelector('.main')?.getAttribute('aria-busy'), alert: document.querySelector('[role=alert]')?.innerText?.slice(0, 120) ?? null,
        skelVisibleAtEnd: skelAfter, liveRegions: document.querySelectorAll('[aria-live]').length }; })()`);
    const f = r.frames;
    const first = (pred) => { const x = f.find(pred); return x ? x[0] : null; };
    r.firstSkelVisible = first((x) => x[1] > 0);
    r.lastSkelVisible = (() => { const v = f.filter((x) => x[1] > 0); return v.length ? v[v.length - 1][0] : null; })();
    // Frames after data ready and before the chart canvas exists: what did the chart area show?
    const gap = r.dataReady != null ? f.filter((x) => x[0] >= r.dataReady && !x[3]) : [];
    r.gapFrames = gap.length;
    r.gapWithChartSkeleton = gap.filter((x) => x[2]).length;
    r.gapFirst = gap[0]?.[0] ?? null; r.gapLast = gap.at(-1)?.[0] ?? null;
    r.busyTransitions = f.reduce((acc, x) => { if (!acc.length || acc.at(-1)[1] !== x[4]) acc.push([x[0], x[4]]); return acc; }, []);
    // Chart-skeleton visibility transitions (1 = visible) and the canvas appearing, as [time, state].
    r.chartSkelTransitions = f.reduce((acc, x) => { const s = x[2] + (x[3] ? ':canvas' : ''); if (!acc.length || acc.at(-1)[1] !== s) acc.push([x[0], s]); return acc; }, []);
    // Mark-free timings (work on builds without fx:* marks): first frame with the chart canvas, and
    // first frame where the explorer region is no longer busy (data shown).
    r.firstCanvas = first((x) => x[3] === 1);
    r.dataShown = (() => { const busy = f.findIndex((x) => x[4] === 'true'); const i = f.findIndex((x, k) => k > busy && busy >= 0 && x[4] === 'false'); return i >= 0 ? f[i][0] : null; })();
    r.echartsFetches = page.requests.filter((u) => u.includes('chunk-INSTK3HA')).length;
    r.requestsTotal = page.requests.length;
    delete r.frames;
    results[sc.name] = r;
    console.log(sc.name, JSON.stringify(r));
    page.close();
  }
} finally {
  browser.close();
}
writeFileSync(`${outDir}/results.json`, JSON.stringify(results, null, 1));
