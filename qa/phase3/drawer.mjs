// QA P3-10: source drawer. Opens the drawer from a table cell (category table) or row (total table),
// then checks: value = table cell, account rows sum to the drawer's nominal total, focus trapped
// (30 Tabs stay inside the overlay), Escape closes, focus returns to the opener. Dumps rows for an
// independent cell check (drawer_check.py).
import { launch, newPage, sleep } from '../phase2/cdp.mjs';
import { writeFileSync } from 'node:fs';

const [base, out, json] = process.argv.slice(2);
const cases = JSON.parse(json);
const browser = await launch({ profile: `${out}/profile-drawer`, port: 9371 });
const key = async (page, k, code, vk, shift = false) => {
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0 });
  await sleep(60);
};
const money = (s) => Number(String(s).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
const results = [];
try {
  for (const c of cases) {
    const page = await newPage(browser.port);
    await page.viewport(c.width ?? 1440, c.height ?? 900, { mobile: !!c.mobile });
    await page.goto(`${base}/${c.query}`);
    await page.eval(`[...document.querySelectorAll('.chart-tile button')].find(b => b.textContent.trim() === 'Table')?.click()`);
    await sleep(700);
    // Find the cell: row whose first cell is the FY label, column by header text (or the row button for the total table).
    const opened = await page.eval(`(() => {
      const t = [...document.querySelectorAll('.chart-tile table')].find(x => x.getBoundingClientRect().height > 0);
      const head = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
      const col = ${JSON.stringify(c.column ?? null)} ? head.indexOf(${JSON.stringify(c.column ?? '')}) : 1;
      const tr = [...t.querySelectorAll('tbody tr')].find(r => r.children[0].textContent.trim() === ${JSON.stringify(c.fy)});
      const cell = tr.children[col];
      const btn = cell.querySelector('button') || tr.querySelector('button');
      window.__opener = btn; btn.focus(); btn.click();
      return { col, cellText: cell.textContent.replace(/\\s+/g, ' ').trim(), header: head[col] };
    })()`);
    await sleep(900);
    const d = await page.eval(`(() => {
      const art = document.querySelector('.cdk-overlay-container app-source-drawer');
      if (!art) return null;
      const dd = [...art.querySelectorAll('dl.values dt')].reduce((o, dt) => (o[dt.textContent.trim()] = dt.nextElementSibling.textContent.trim(), o), {});
      return { title: art.querySelector('#drawer-title')?.textContent.trim(), series: [...art.querySelectorAll('.series')].map(p => p.textContent.trim()),
        values: dd, annotations: [...art.querySelectorAll('section[aria-labelledby="drawer-annotations"] li')].map(li => li.childNodes[0].textContent.trim()),
        rows: [...art.querySelectorAll('section[aria-labelledby="drawer-accounts"] tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim())),
        sources: [...art.querySelectorAll('section[aria-labelledby="drawer-sources"] a')].map(a => a.textContent.trim().slice(0, 60)),
        focusInside: art.closest('.cdk-overlay-container').contains(document.activeElement) };
    })()`);
    let trapped = null, closed = null, focusBack = null;
    if (d) {
      trapped = true;
      for (let i = 0; i < 30; i++) {
        await key(page, 'Tab', 'Tab', 9, i % 7 === 6);
        const inside = await page.eval(`document.querySelector('.cdk-overlay-container').contains(document.activeElement)`);
        if (!inside) { trapped = false; break; }
      }
      await key(page, 'Escape', 'Escape', 27);
      await sleep(700);
      closed = !(await page.eval(`!!document.querySelector('.cdk-overlay-container app-source-drawer')`));
      focusBack = await page.eval(`document.activeElement === window.__opener`);
    }
    const sum = d ? d.rows.reduce((s, r) => s + money(r[3]), 0) : null;
    const nominal = d ? money(d.values['Nominal total of the amounts below']) : null;
    const r = { name: c.name, query: c.query, fy: c.fy, column: opened.header, cellText: opened.cellText, drawer: d, rowsSum: sum, nominal, sumMatches: d ? sum === nominal : null,
      valueMatchesCell: d ? d.values['Value'] === opened.cellText : null, trapped, closed, focusBack };
    results.push(r);
    console.log(`${c.name.padEnd(26)} value ${d?.values.Value} | cell ${opened.cellText} | rows ${d?.rows.length} sum=${sum} nominal=${nominal} | sum ok ${r.sumMatches} | value=cell ${r.valueMatchesCell} | annotations ${JSON.stringify(d?.annotations)} | crossCheck ${d?.values['Cross-check']} | focusIn ${d?.focusInside} trapped ${trapped} esc ${closed} focusBack ${focusBack}`);
    await page.close();
  }
} finally {
  browser.close();
}
writeFileSync(`${out}/drawer.json`, JSON.stringify(results, null, 1));
