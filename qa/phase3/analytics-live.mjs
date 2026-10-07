// QA P3-11 (under P3-10): Cloudflare Web Analytics on a deployed build. For each scenario (plain,
// Do Not Track, Global Privacy Control; desktop and phone) it records every request, the beacon
// script's data-cf-beacon, cookies for all origins, local/session storage keys, CLS and the Privacy
// text. The RUM page-view report (cloudflareinsights.com/cdn-cgi/rum) is blocked in every scenario so
// QA runs never count as visits; blocked requests are still listed, marked "blocked".
// Usage: node qa/phase3/analytics-live.mjs <site url> <out dir> [port]
import { launch, newPage, sleep } from '../phase2/cdp.mjs';

const [site, out, port = '9377'] = process.argv.slice(2);
const BLOCK = ['*cloudflareinsights.com/cdn-cgi/*', '*/cdn-cgi/rum*'];
const browser = await launch({ profile: `${out}/profile-analytics-${Date.now()}`, port: Number(port) });
const results = [];
try {
  for (const [name, nav] of [['plain', {}], ['dnt', { doNotTrack: '1' }], ['gpc', { globalPrivacyControl: true }]]) {
    for (const phone of [false, true]) {
      const page = await newPage(browser.port);
      const blocked = new Set();
      page.on((m) => {
        if (m.method === 'Network.loadingFailed' && m.params.blockedReason) blocked.add(m.params.requestId);
      });
      const ids = new Map();
      page.on((m) => { if (m.method === 'Network.requestWillBeSent') ids.set(m.params.requestId, m.params.request.url); });
      await page.send('Network.setBlockedURLs', { urls: BLOCK });
      await page.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.send('Network.clearBrowserCookies');
      const overrides = Object.entries(nav).map(([k, v]) => `Object.defineProperty(Navigator.prototype, '${k}', { get: () => ${JSON.stringify(v)}, configurable: true });`).join('\n');
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `${overrides}
        window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });` });
      if (phone) await page.viewport(390, 844, { mobile: true, scale: 3 });
      else await page.viewport(1440, 900);
      await page.goto(site, 4000);
      const dom = await page.eval(`({
        scripts: [...document.querySelectorAll('script[src*="cloudflareinsights"]')].map(s => ({ src: s.src, beacon: s.getAttribute('data-cf-beacon'), defer: s.defer, async: s.async })),
        cookie: document.cookie, local: Object.keys(localStorage), session: Object.keys(sessionStorage),
        cls: window.__cls, dnt: navigator.doNotTrack, gpc: navigator.globalPrivacyControl ?? null,
        privacy: document.querySelector('.privacy')?.innerText.replace(/\\s+/g, ' ').trim() ?? null })`);
      const cookies = (await page.send('Network.getAllCookies')).cookies.map((c) => `${c.domain} ${c.name}`);
      // Leave the page while still attached, so a beacon sent on pagehide is blocked too (detaching
      // first would drop the block before the tab closes).
      await page.send('Page.navigate', { url: 'about:blank' });
      await sleep(1500);
      const reqs = [...ids].map(([id, url]) => (blocked.has(id) ? 'BLOCKED ' : '') + url);
      const third = reqs.filter((u) => !u.replace('BLOCKED ', '').startsWith(new URL(site).origin) && !u.startsWith('data:'));
      results.push({ name, phone, dom, cookies, thirdParty: third, requests: reqs.length });
      await page.close();
    }
  }
} finally {
  browser.close();
}
for (const r of results) {
  console.log(`== ${r.name} ${r.phone ? 'phone' : 'desktop'}: ${r.requests} requests; dnt=${r.dom.dnt} gpc=${r.dom.gpc}; CLS ${r.dom.cls}`);
  console.log('   third-party:', JSON.stringify(r.thirdParty));
  console.log('   beacon scripts:', JSON.stringify(r.dom.scripts));
  console.log('   cookies (all origins):', JSON.stringify(r.cookies), 'document.cookie:', JSON.stringify(r.dom.cookie));
  console.log('   localStorage:', JSON.stringify(r.dom.local), 'sessionStorage:', JSON.stringify(r.dom.session));
  console.log('   privacy:', JSON.stringify(r.dom.privacy));
}
