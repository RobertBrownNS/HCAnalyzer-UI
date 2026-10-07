// QA P2-15: repeat a throttled load N times and report whether the page finishes (aria-busy false,
// chart canvas drawn) or stays in the loading state. Captures console errors and a screenshot of stuck runs.
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out, runsArg = '5', netName = 'slow4g', cpuArg = '4'] = process.argv.slice(2);
const NET = {
  fast4g: { latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
  slow4g: { latency: 562.5, downloadThroughput: ((1.44 * 1024 * 1024) / 8) * 0.9, uploadThroughput: ((675 * 1024) / 8) * 0.9 },
};
const browser = await launch({ profile: `${out}/profile-stuck`, port: 9355 });
try {
  for (let i = 1; i <= Number(runsArg); i++) {
    const page = await newPage(browser.port);
    await page.viewport(390, 844, { mobile: true });
    await page.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.send('Network.emulateNetworkConditions', { offline: false, ...NET[netName] });
    await page.send('Emulation.setCPUThrottlingRate', { rate: Number(cpuArg) });
    const t0 = Date.now();
    await page.send('Page.navigate', { url: `${base}/?flow=revenue` });
    let state;
    for (let k = 0; k < 120; k++) {
      await sleep(250);
      state = await page.eval(`({ busy: document.querySelector('.main')?.getAttribute('aria-busy') ?? null,
        canvas: !!document.querySelector('app-series-chart canvas'),
        rendered: performance.getEntriesByName('fx:chartRendered').length > 0,
        dataReady: Math.round(performance.getEntriesByName('fx:dataReady')[0]?.startTime ?? -1),
        status: document.querySelector('[role=alert]') ? 'alert' : null,
        kpi: document.querySelector('app-kpi-row li .value')?.textContent.trim() ?? null })`).catch(() => null);
      if (state && (state.rendered || state.status)) break;
    }
    const ms = Date.now() - t0;
    const stuck = !(state && (state.rendered || state.status));
    console.log(`run ${i}: ${stuck ? 'STUCK' : 'ok   '} after ${ms} ms`, JSON.stringify(state), page.console.length ? 'console: ' + JSON.stringify(page.console) : '');
    if (stuck) await page.shot(`${out}/stuck-${netName}-cpu${cpuArg}-${i}.png`);
    page.close();
  }
} finally {
  browser.close();
}
