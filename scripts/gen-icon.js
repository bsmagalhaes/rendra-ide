// Generates the Rendra IDE icon: assets/icon.ico (16, 32, 48, 256), icon.png (256),
// icon-1024.png (macOS/Linux) and icon.svg (site favicon).
// Design: black rounded square with an orange "</>" code mark.
// Run: npm run gen-icon

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [10, 10, 10];    // #0a0a0a
const FG = [232, 101, 10];  // #e8650a, the app's orange accent
const RADIUS = 0.2;         // corner radius, as a fraction of the size

// "</>" as stroked segments in a 0..1 box
const SEGMENTS = [
  [0.35, 0.31, 0.15, 0.50], [0.15, 0.50, 0.35, 0.69], // <
  [0.555, 0.28, 0.445, 0.72],                         // /
  [0.65, 0.31, 0.85, 0.50], [0.85, 0.50, 0.65, 0.69], // >
];

// ── CRC32 (for PNG chunks) ──────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t   = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

// ── Pixel renderer ──────────────────────────────────────────────────────────
function segDist(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function insideRoundedSquare(u, v) {
  const r = RADIUS;
  const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

// 4×4 supersampling per pixel for smooth edges; strokes get thicker at tiny sizes to stay legible
function renderPixels(size) {
  const buf = Buffer.alloc(size * size * 4);
  const half = Math.max(0.04, 0.9 / size);
  const N = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
        const u = (x + (sx + 0.5) / N) / size, v = (y + (sy + 0.5) / N) / size;
        if (!insideRoundedSquare(u, v)) continue;
        if (SEGMENTS.some(s => segDist(u, v, s) <= half)) fg++; else bg++;
      }
      const cover = (bg + fg) / (N * N);
      const i = (y * size + x) * 4;
      if (!cover) continue;
      const k = fg / (bg + fg);
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(BG[c] * (1 - k) + FG[c] * k);
      buf[i + 3] = Math.round(cover * 255);
    }
  }
  return buf;
}

function renderSVG() {
  const hex = c => '#' + c.map(n => n.toString(16).padStart(2, '0')).join('');
  const p = n => Math.round(n * 1000) / 10;
  const lines = SEGMENTS.map(([x1, y1, x2, y2]) => `M${p(x1)} ${p(y1)}L${p(x2)} ${p(y2)}`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${RADIUS * 100}" fill="${hex(BG)}"/>` +
    `<path d="${lines}" fill="none" stroke="${hex(FG)}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
}

// ── PNG encoder ─────────────────────────────────────────────────────────────
function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0); ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // RGBA color type
  const ihdr = pngChunk('IHDR', ihdrData);

  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter None
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = y * stride + 1 + x * 4;
      raw[d] = rgba[s]; raw[d+1] = rgba[s+1]; raw[d+2] = rgba[s+2]; raw[d+3] = rgba[s+3];
    }
  }
  const idat = pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ── ICO builder ─────────────────────────────────────────────────────────────
function buildICO(sizes) {
  const pngs = sizes.map(s => encodePNG(s, renderPixels(s)));
  const N = pngs.length;
  const header = Buffer.alloc(6 + 16 * N);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);   // type = icon
  header.writeUInt16LE(N, 4);

  let offset = 6 + 16 * N;
  for (let i = 0; i < N; i++) {
    const e = 6 + 16 * i;
    const s = sizes[i];
    header.writeUInt8(s >= 256 ? 0 : s, e);
    header.writeUInt8(s >= 256 ? 0 : s, e + 1);
    header.writeUInt8(0, e + 2);
    header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  }
  return Buffer.concat([header, ...pngs]);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const outDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

const ico = buildICO([16, 32, 48, 256]);
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log(`✓  assets/icon.ico  (${(ico.length / 1024).toFixed(1)} KB, sizes: 16 32 48 256)`);

const png256 = encodePNG(256, renderPixels(256));
fs.writeFileSync(path.join(outDir, 'icon.png'), png256);
console.log(`✓  assets/icon.png  (${(png256.length / 1024).toFixed(1)} KB, 256×256)`);

// macOS (.icns is built from it) and Linux packages need a large source image
const png1024 = encodePNG(1024, renderPixels(1024));
fs.writeFileSync(path.join(outDir, 'icon-1024.png'), png1024);
console.log(`✓  assets/icon-1024.png  (${(png1024.length / 1024).toFixed(1)} KB, 1024×1024)`);

fs.writeFileSync(path.join(outDir, 'icon.svg'), renderSVG());
console.log('✓  assets/icon.svg');
