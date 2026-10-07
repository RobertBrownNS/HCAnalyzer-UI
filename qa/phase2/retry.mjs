// QA P2-15: fail the first load (404 on cpi.json), then click Retry with the file available.
// The second load must finish (busy false, chart drawn, KPIs filled) with no skeleton left.
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-retry`, port: 9357 });
try {
  const page = await newPage(browser.port);
  await page.viewport(390, 844, { mobile: true });
  let failNext = true;
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*assets/data/cpi.json*', requestStage: 'Request' }] });
  page.on(async (m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    const { requestId } = m.params;
    await sleep(800);
    if (failNext) {
      failNext = false;
      return page.send('Fetch.fulfillRequest', { requestId, responseCode: 404, body: Buffer.from('nf').toString('base64') });
    }
    return page.send('Fetch.continueRequest', { requestId });
  });
  await page.send('Page.navigate', { url: `${base}/?flow=revenue` });
  await sleep(3000);
  const state = () => page.eval(`({ alert: !!document.querySelector('[role=alert]'), busy: document.querySelector('.main')?.getAttribute('aria-busy'),
    skeletons: [...document.querySelectorAll('.fx-skel')].filter(el => !el.closest('.fx-skel-pending') && el.getBoundingClientRect().height > 0).length,
    canvas: !!document.querySelector('app-series-chart canvas'), kpi: document.querySelector('app-kpi-row li .value')?.textContent.trim(),
    chip: [...document.querySelectorAll('.chips button')].map(b => b.textContent.trim()).find(t => t.startsWith('FY') || t === 'Fiscal years') })`);
  console.log('after failed load:', JSON.stringify(await state()));
  await page.eval(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Retry').click()`);
  const seen = [];
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const s = await state();
    seen.push(`${s.busy}/${s.skeletons}`);
    if (s.canvas && s.busy === 'false') break;
  }
  await sleep(800);
  console.log('busy/skeletons during retry:', seen.join(' '));
  console.log('after retry:', JSON.stringify(await state()));
} finally {
  browser.close();
}
