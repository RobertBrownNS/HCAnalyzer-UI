// QA P2-12: phone bottom sheet (targets, focus, Escape) and keyboard walk on desktop.
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-sheet`, port: 9335 });
const key = async (page, k, code = k, keyCode = 0) => {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode });
  await sleep(150);
};
const active = (page) => page.eval(`(() => { const a = document.activeElement; const r = a.getBoundingClientRect();
  const cs = getComputedStyle(a); return { tag: a.tagName.toLowerCase(), name: (a.getAttribute('aria-label') || a.textContent || a.value || '').replace(/\\s+/g,' ').trim().slice(0, 50),
  outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
try {
  for (const dark of [false, true]) {
    const page = await newPage(browser.port);
    await page.viewport(390, 844, { mobile: true, dark });
    await page.goto(`${base}/?flow=revenue&measure=real`);
    const chips = await page.eval(`[...document.querySelectorAll('.chips button')].length`);
    for (let i = 0; i < chips; i++) {
      await page.eval(`document.querySelectorAll('.chips button')[${i}].focus(); document.querySelectorAll('.chips button')[${i}].click()`);
      await sleep(900);
      const info = await page.eval(`(() => { const c = document.querySelector('.mat-bottom-sheet-container'); if (!c) return null;
        const els = [...c.querySelectorAll('button, a[href], input, select, [role=slider]')];
        return { label: c.getAttribute('aria-label'), text: c.textContent.replace(/\\s+/g,' ').trim().slice(0, 160),
          targets: els.map(e => { const r = (e.type === 'checkbox' ? e.closest('label') || e : e).getBoundingClientRect(); return [e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), Math.round(r.width), Math.round(r.height)]; }),
          focusInside: c.contains(document.activeElement) }; })()`);
      if (i === 1) await page.shot(`${out}/sheet-${dark ? 'dark' : 'light'}.png`);
      await key(page, 'Escape', 'Escape', 27);
      await sleep(700);
      const after = await active(page);
      const open = await page.eval(`!!document.querySelector('.mat-bottom-sheet-container')`);
      console.log(dark ? 'dark' : 'light', 'chip', i, JSON.stringify(info), '| after Esc open:', open, 'focus:', after.name);
    }
    page.close();
  }
  // Keyboard walk on desktop: Tab through the first 30 stops, record focus indicator.
  const page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.goto(`${base}/?flow=revenue`);
  for (let i = 0; i < 30; i++) {
    await key(page, 'Tab', 'Tab', 9);
    const a = await active(page);
    console.log('tab', i, a.tag, '|', a.name, '|', a.outline, '|', a.shadow);
  }
} finally {
  browser.close();
}
