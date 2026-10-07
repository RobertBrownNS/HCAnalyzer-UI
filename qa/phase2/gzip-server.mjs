// QA P2-15: static server for the build output with gzip (like IIS/GitHub Pages), at the site root.
// Optional hold: requests whose path contains HOLD_MATCH are delayed by HOLD_MS (e.g. the ECharts chunk).
// Every request is logged with its path so duplicate fetches can be counted.
// Usage: node qa/phase2/gzip-server.mjs <distDir> <port> <logFile>   env: HOLD_MATCH, HOLD_MS
import { createServer } from 'node:http';
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';

const [dist, port = '4300', log] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };
const cache = new Map();
if (log) writeFileSync(log, '');

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = join(dist, normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  if (log) appendFileSync(log, `${Date.now()} ${url.pathname}\n`);
  const type = TYPES[extname(file)] ?? 'application/octet-stream';
  const gz = /gzip/.test(req.headers['accept-encoding'] ?? '') && /text|json|javascript/.test(type);
  const key = file + (gz ? ':gz' : '');
  if (!cache.has(key)) cache.set(key, gz ? gzipSync(readFileSync(file)) : readFileSync(file));
  const body = cache.get(key);
  const send = () => {
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(body);
  };
  const hold = process.env.HOLD_MATCH && url.pathname.includes(process.env.HOLD_MATCH);
  if (hold) setTimeout(send, Number(process.env.HOLD_MS ?? 5000)); else send();
}).listen(Number(port), '127.0.0.1');
console.log(`gzip server on ${port}`);
