// QA P2-12: what the user sees when a data file fails to load, or the manifest reports a different schema.
import { launch, newPage, sleep } from './cdp.mjs';
const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-fail`, port: 9343 });
try {
  for (const mode of ['missing-cpi', 'schema-99']) {
    const page = await newPage(browser.port);
    await page.viewport(1440, 900);
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*assets/data/*', requestStage: 'Request' }] });
    page.on(async (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = m.params;
      if (mode === 'missing-cpi' && request.url.includes('cpi.json')) {
        await page.send('Fetch.fulfillRequest', { requestId, responseCode: 404, body: Buffer.from('not found').toString('base64') });
      } else if (mode === 'schema-99' && request.url.includes('manifest.json')) {
        const real = await (await fetch(request.url)).json();
        real.schemaVersion = 99; real.dataVersion = 'tampered';
        await page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(real)).toString('base64') });
      } else await page.send('Fetch.continueRequest', { requestId });
    });
    await page.send('Page.navigate', { url: `${base}/?flow=revenue` });
    await sleep(4000);
    const r = await page.eval(`({ alert: document.querySelector('[role=alert]')?.innerText ?? null, chart: !!document.querySelector('app-series-chart canvas'), kpi: document.querySelector('app-kpi-row li .value')?.textContent.trim() })`);
    console.log(mode, JSON.stringify(r));
    page.close();
  }
} finally { browser.close(); }
