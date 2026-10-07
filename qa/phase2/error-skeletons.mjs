// QA P2-15: after a failed load, which skeleton shapes are still visible, and where?
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-errskel`, port: 9353 });
try {
  const page = await newPage(browser.port);
  await page.viewport(390, 844, { mobile: true });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*assets/data/cpi.json*', requestStage: 'Request' }] });
  page.on(async (m) => {
    if (m.method !== 'Fetch.requestPaused') return;
    await sleep(1500);
    await page.send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, body: Buffer.from('nf').toString('base64') });
  });
  await page.send('Page.navigate', { url: `${base}/?flow=revenue` });
  await sleep(5000);
  const info = await page.eval(`[...document.querySelectorAll('.fx-skel')].filter(el => !el.closest('.fx-skel-pending') && el.getBoundingClientRect().height > 0)
    .map(el => { const host = el.closest('app-range-control, app-kpi-row, app-chart-skeleton, section, p'); const r = el.getBoundingClientRect();
      return { cls: el.className, in: host ? host.tagName.toLowerCase() + '.' + String(host.className).split(' ')[0] : null, y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height),
        ariaHidden: !!el.closest('[aria-hidden=true]') }; })`);
  console.log(JSON.stringify(info, null, 1));
  const y = info[0]?.y ?? 0;
  await page.eval(`scrollTo(0, ${Math.max(0, y - 300)})`);
  await sleep(300);
  await page.shot(`${out}/error-skeletons.png`);
  console.log('range readout present:', await page.eval(`!!document.querySelector('app-range-control .readout')`),
    '| retry button:', await page.eval(`!![...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Retry')`));
} finally {
  browser.close();
}
