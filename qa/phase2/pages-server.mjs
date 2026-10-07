// QA P2-14: a GitHub Pages-like static server for the build output, served under a sub-path.
// - /<sub> (no slash) -> 301 to /<sub>/ (as Pages does for directories)
// - existing file -> 200; directory -> its index.html
// - anything else under /<sub>/ -> /<sub>/404.html with status 404
// - anything outside /<sub>/ -> plain 404 (and logged, so stray requests are visible)
// Usage: node qa/phase2/pages-server.mjs <distDir> <port> <subPath> <logFile>
import { createServer } from 'node:http';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const [dist, port = '4400', sub = '/HCAnalyzer-UI/', log] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png' };
if (log) writeFileSync(log, '');

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, file, note) => {
    if (log) appendFileSync(log, `${status} ${req.url}${note ? ' ' + note : ''}\n`);
    if (!file) { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(readFileSync(file));
  };
  if (url.pathname === sub.slice(0, -1)) {
    if (log) appendFileSync(log, `301 ${req.url}\n`);
    res.writeHead(301, { Location: sub + url.search }); res.end(); return;
  }
  if (!url.pathname.startsWith(sub)) return send(404, null, 'OUTSIDE-SUBPATH');
  const rel = normalize(decodeURIComponent(url.pathname.slice(sub.length))).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) return send(403, null);
  let file = join(dist, rel);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (existsSync(file) && statSync(file).isFile()) return send(200, file);
  return send(404, join(dist, '404.html'), 'fallback-404.html');
}).listen(Number(port), '127.0.0.1');
console.log(`serving ${dist} at http://127.0.0.1:${port}${sub}`);
