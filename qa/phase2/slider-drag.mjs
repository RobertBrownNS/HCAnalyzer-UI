// QA P2-12 re-check: does dragging a range-slider thumb add one history entry per drag (not one per step)?
// Uses touch on phone and mouse on desktop, aimed at the visual thumb centre.
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-slider`, port: 9349 });
const readout = (p) => p.eval(`document.querySelector('app-range-control .readout').textContent.trim()`);
try {
  for (const mobile of [false, true]) {
    const page = await newPage(browser.port);
    await page.viewport(mobile ? 390 : 1440, mobile ? 844 : 900, { mobile });
    await page.goto(`${base}/?flow=revenue`);
    await page.eval(`document.querySelector('app-range-control').scrollIntoView({ block: 'center' })`);
    await sleep(300);
    const t = await page.eval(`(() => { const th = document.querySelectorAll('app-range-control .mdc-slider__thumb')[0].getBoundingClientRect();
      const tr = document.querySelector('app-range-control .mdc-slider').getBoundingClientRect();
      return { x: th.x + th.width / 2, y: th.y + th.height / 2, w: tr.width }; })()`);
    const h0 = await page.eval('history.length');
    const before = await readout(page);
    const steps = 12;
    const dx = (t.w * 0.4) / steps;
    if (mobile) {
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t.x, y: t.y }] });
      for (let i = 1; i <= steps; i++) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: t.x + i * dx, y: t.y }] });
        await sleep(40);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x, y: t.y });
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= steps; i++) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: t.x + i * dx, y: t.y, button: 'left', buttons: 1 });
        await sleep(40);
      }
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: t.x + steps * dx, y: t.y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(1000);
    const after = await readout(page);
    const added = (await page.eval('history.length')) - h0;
    console.log(mobile ? 'phone  ' : 'desktop', '| readout', before, '->', after, '| history entries added:', added);
    if (added > 0) {
      await page.eval('history.back()');
      await sleep(1000);
      console.log('         after one Back:', await readout(page));
    }
    page.close();
  }
} finally {
  browser.close();
}
