// Generates the site icons from one geometry: the approved design (team lead's draft, user-approved
// 2026-10-07), four amber bars on the header's navy, as a rounded square. Writes, into src/:
//   favicon.svg            primary icon (modern browsers)
//   favicon.ico            16, 32 and 48 px (PNG-compressed entries), fallback for older browsers
//   apple-touch-icon.png   180 px, opaque full square (iOS rounds the corners itself)
//   icon-192.png, icon-512.png   for the Phase 6 PWA manifest (not referenced yet)
// No dependencies: shapes are axis-aligned rectangles and a rounded square, rasterized here with
// 8x8 supersampling and encoded with node:zlib, so the output is the same on every run.
// Usage: node tools/favicons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

// Theme D colours (src/styles/_tokens.scss: header-bg, logo-accent).
const NAVY = [0x1f, 0x2a, 0x44];
const AMBER = [0xf2, 0xb5, 0x44];

// Geometry on a 32-unit grid with even coordinates, so every edge lands on a whole pixel at 16, 32
// and 48 px. Bars have square corners.
const GRID = 32;
const RADIUS = 6; // rounded square corner
const BARS = [
  // x, top, width; all bars end at the baseline (heights 10, 18, 12, 20).
  { x: 6, top: 16, w: 4 },
  { x: 12, top: 8, w: 4 },
  { x: 18, top: 14, w: 4 },
  { x: 24, top: 6, w: 4 },
];
const BASELINE = 26;

function svg() {
  const bars = BARS.map((b) => `<rect x="${b.x}" y="${b.top}" width="${b.w}" height="${BASELINE - b.top}"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges">` +
    `<rect width="${GRID}" height="${GRID}" rx="${RADIUS}" fill="#1f2a44" shape-rendering="geometricPrecision"/>` +
    `<g fill="#f2b544">${bars}</g></svg>\n`
  );
}

/** Inside the background at grid point (x, y)? `rounded` false = full square (apple-touch-icon). */
function inBackground(x, y, rounded) {
  if (x < 0 || y < 0 || x > GRID || y > GRID) return false;
  if (!rounded) return true;
  const cx = Math.min(Math.max(x, RADIUS), GRID - RADIUS);
  const cy = Math.min(Math.max(y, RADIUS), GRID - RADIUS);
  return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS ** 2;
}

function inBar(x, y) {
  return BARS.some((b) => x >= b.x && x < b.x + b.w && y >= b.top && y < BASELINE);
}

/** RGBA pixels at `size` px. */
function raster(size, rounded) {
  const SS = 8;
  const px = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let bg = 0;
      let bar = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((pxi + (sx + 0.5) / SS) / size) * GRID;
          const y = ((py + (sy + 0.5) / SS) / size) * GRID;
          if (inBackground(x, y, rounded)) {
            bg++;
            if (inBar(x, y)) bar++;
          }
        }
      }
      const n = SS * SS;
      const i = (py * size + pxi) * 4;
      // Colour = the mix of amber and navy inside the shape; alpha = background coverage.
      const t = bg ? bar / bg : 0;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(NAVY[c] + (AMBER[c] - NAVY[c]) * t);
      px[i + 3] = Math.round((bg / n) * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG from RGBA pixels; `opaque` drops the alpha channel (RGB, colour type 2). */
function png(size, rgba, opaque = false) {
  const channels = opaque ? 3 : 4;
  const rows = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * channels + 1); // filter byte 0 (none)
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < channels; c++) rows[row + 1 + x * channels + c] = rgba[(y * size + x) * 4 + c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // RGB / RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO with PNG-compressed entries. */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = entries.map(({ size, data }) => {
    const d = Buffer.alloc(16);
    d[0] = size >= 256 ? 0 : size;
    d[1] = size >= 256 ? 0 : size;
    d.writeUInt16LE(1, 4); // colour planes
    d.writeUInt16LE(32, 6); // bits per pixel
    d.writeUInt32LE(data.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += data.length;
    return d;
  });
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

const out = (name, data) => {
  writeFileSync(new URL(`../src/${name}`, import.meta.url), data);
  console.log(`favicons: wrote src/${name} (${data.length} bytes)`);
};

out('favicon.svg', svg());
out('favicon.ico', ico([16, 32, 48].map((size) => ({ size, data: png(size, raster(size, true)) }))));
out('apple-touch-icon.png', png(180, raster(180, false), true));
out('icon-192.png', png(192, raster(192, true)));
out('icon-512.png', png(512, raster(512, true)));
