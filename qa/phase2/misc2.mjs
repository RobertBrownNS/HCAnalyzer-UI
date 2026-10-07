// QA P2-12 re-check: Share copy failure (visible link?), slider drag history entries,
// QA-19 note text, QA-22 phone chip row. Regexes run in Node, not inside page.eval strings.
import { launch, newPage, sleep } from './cdp.mjs';

const [base, out] = process.argv.slice(2);
const browser = await launch({ profile: `${out}/profile-misc2`, port: 9348 });
const squash = (s) => s.replace(/\s+/g, ' ').trim();
try {
  // 1. Share with clipboard writes rejected.
  let page = await newPage(browser.port);
  await page.viewport(1440, 900);
  await page.goto(`${base}/?flow=revenue`);
  await page.eval(`navigator.clipboard.writeText = () => Promise.reject(new Error('denied'))`);
  await page.eval(`[...document.querySelectorAll('header button')].find(b => b.textContent.includes('Share')).click()`);
  await sleep(500);
  const shareInfo = await page.eval(`({ header: document.querySelector('header').innerText,
    visible: [...document.querySelectorAll('input, textarea, a, output')].filter(e => e.getBoundingClientRect().width > 0)
      .map(e => e.tagName + ':' + (e.value || e.textContent || '')) })`);
  console.log('share-fail header:', squash(shareInfo.header));
  console.log('share-fail visible elements holding the URL:', shareInfo.visible.filter((v) => v.includes('flow=revenue')).map((v) => v.slice(0, 120)));
  await page.shot(`${out}/share-fail.png`);

  // 2. Drag the start thumb of the range slider; count history entries added.
  const h0 = await page.eval('history.length');
  const thumb = await page.eval(`(() => { const t = document.querySelector('app-range-control .mdc-slider__thumb'); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: thumb.x, y: thumb.y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 20; i++) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: thumb.x + i * 20, y: thumb.y, button: 'left', buttons: 1 });
    await sleep(40);
  }
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: thumb.x + 400, y: thumb.y, button: 'left', clickCount: 1 });
  await sleep(900);
  console.log('slider drag: history +', (await page.eval('history.length')) - h0, '| readout',
    await page.eval(`document.querySelector('app-range-control .readout').textContent.trim()`));
  page.close();

  // 3. QA-19: note text with Tampa CPI and a base year inside the gap; QA-22: phone chip row.
  page = await newPage(browser.port);
  await page.viewport(390, 844, { mobile: true });
  await page.goto(`${base}/?flow=revenue&measure=real&cpi=cpi-u-tampa&base=2010`);
  const notes = (await page.eval(`[...document.querySelectorAll('app-view-notes li')].map(l => l.textContent)`)).map(squash);
  console.log('notes count', notes.length);
  for (const n of notes.filter((x) => /CPI|base/i.test(x))) console.log('   ', n.slice(0, 330));
  const all = await page.eval('document.body.innerText');
  console.log('internal identifiers on page:', [...new Set(all.match(/\b[\w-]+\.(json|xlsx|ts)\b|tampa_semiannual|calendarYear|fiscalYearUnavailable/g) ?? [])]);
  const table = await page.eval(`(() => { [...document.querySelectorAll('.chart-tile button')].find(b => b.textContent.includes('table')).click(); return true; })()`);
  await sleep(500);
  const rows = await page.eval(`[...document.querySelectorAll('app-series-table tbody tr')].map(tr => tr.lastElementChild.textContent)`);
  console.log('table note FY2017-18 row:', squash(rows[12] ?? '').slice(0, 260), table);
  console.log('chip row:', JSON.stringify(await page.eval(`(() => { const c = document.querySelector('.chips'); const cs = getComputedStyle(c);
    return { scrollW: c.scrollWidth, clientW: c.clientWidth, overflowX: cs.overflowX, mask: cs.maskImage || cs.webkitMaskImage,
      afterContent: getComputedStyle(c, '::after').content, parentAfter: getComputedStyle(c.parentElement, '::after').content }; })()`)));
  await page.goto(`${base}/?flow=expenditure`);
  await page.shot(`${out}/phone-exp.png`);
  console.log('phone overflow', await page.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth'));
} finally {
  browser.close();
}
