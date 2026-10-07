// Minimal Chrome DevTools Protocol driver for QA (no Puppeteer). Node 22+ (global WebSocket).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, profile }) {
  mkdirSync(profile, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  return { proc, port, close: () => proc.kill() };
}

export async function newPage(port) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const page = {
    send,
    on: (fn) => listeners.push(fn),
    requests: [],
    console: [],
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    async viewport(width, height, { mobile = false, dark = false, scale = 1 } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
      await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    },
    async goto(url, settleMs = 1500) {
      await send('Page.navigate', { url });
      for (let i = 0; i < 60; i++) {
        await sleep(250);
        const ready = await page.eval(`document.readyState === 'complete' && !!document.querySelector('app-series-chart canvas, app-series-table table, [role=alert]')`).catch(() => false);
        if (ready) break;
      }
      await sleep(settleMs);
    },
    async shot(path, full = false) {
      const p = full ? { captureBeyondViewport: true } : {};
      if (full) {
        const h = await page.eval('document.documentElement.scrollHeight');
        const w = await page.eval('document.documentElement.clientWidth');
        p.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
      }
      const r = await send('Page.captureScreenshot', { format: 'png', ...p });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
    },
    // Close the tab too, not just the socket: leftover tabs push later pages into the background,
    // where Chrome pauses requestAnimationFrame (that froze load-probe's frame recorder).
    close: () => { ws.close(); return fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {}); },
  };
  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Runtime.enable');
  await send('Network.enable');
  page.on((m) => {
    if (m.method === 'Network.requestWillBeSent') page.requests.push(m.params.request.url);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      page.console.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') page.console.push('exception: ' + m.params.exceptionDetails.exception?.description);
  });
  return page;
}

export { sleep };
