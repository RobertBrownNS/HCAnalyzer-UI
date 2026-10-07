// QA P2-12 (QA-23 follow-up): do arrow keys on a range-slider thumb still change the range?
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-keys`, port: 9351 });
const key = async (page, k, code, vk) => {
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  await sleep(400);
};
try {
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.goto(`${base}/?flow=revenue`);
  const readout = () => page.eval(`document.querySelector('app-range-control .readout').textContent.trim()`);
  const h0 = await page.eval('history.length');
  await page.eval(`document.querySelector('app-range-control input[aria-label="First fiscal year"]').focus()`);
  console.log('start', await readout());
  await key(page, 'ArrowRight', 'ArrowRight', 39);
  console.log('after 1 ArrowRight', await readout(), '| history +', (await page.eval('history.length')) - h0);
  await key(page, 'ArrowRight', 'ArrowRight', 39);
  console.log('after 2 ArrowRight', await readout(), '| history +', (await page.eval('history.length')) - h0);
  await page.eval(`document.querySelector('app-range-control input[aria-label="Last fiscal year"]').focus()`);
  await key(page, 'ArrowLeft', 'ArrowLeft', 37);
  console.log('end thumb ArrowLeft', await readout(), '| url', await page.eval(`location.search.split('&').filter(p => p.startsWith('from') || p.startsWith('to')).join('&')`));
} finally {
  browser.close();
}
