#!/usr/bin/env node
/**
 * Deterministic PWA icon generator — zero dependencies, pure Node.
 *
 * Draws the RAI install icons programmatically and writes PNGs to public/icons/:
 *   icon-192.png          192×192  purpose "any"
 *   icon-512.png          512×512  purpose "any"
 *   icon-maskable-512.png 512×512  purpose "maskable" (mark inside the 80% safe zone)
 *   apple-touch-icon.png  180×180  opaque, referenced from metadata.icons.apple
 *
 * Mark: the orange "A" chevron from the RAI wordmark (src/components/RaiLogo.tsx)
 * — the brand's hue anchor — on the palette's near-black oxford/ink field.
 * Colors come straight from globals.css: --color-brand #ff8400, --color-ink #0b0829.
 *
 * Run: node scripts/generate-pwa-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

const OXFORD = [0x0b, 0x08, 0x29]; // #0b0829 — near-black field (ink/oxford)
const BRAND = [0xff, 0x84, 0x00]; // #ff8400 — brand orange

/* ------------------------------------------------------------------ */
/* Minimal PNG encoder (RGBA8, non-interlaced, deflate via zlib)       */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // compression/filter/interlace stay 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ */
/* Tiny rasterizer: flat fills + scanline polygons (all we need)       */
/* ------------------------------------------------------------------ */

function makeCanvas(size, bg) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { size, data };
}

function setPx(canvas, x, y, rgb) {
  if (x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const i = (y * canvas.size + x) * 4;
  canvas.data[i] = rgb[0];
  canvas.data[i + 1] = rgb[1];
  canvas.data[i + 2] = rgb[2];
}

/** Filled convex polygon via even-odd scanline. Points: [[x,y], ...] */
function fillPoly(canvas, pts, rgb) {
  const ys = pts.map((p) => p[1]);
  const yMin = Math.max(0, Math.floor(Math.min(...ys)));
  const yMax = Math.min(canvas.size - 1, Math.ceil(Math.max(...ys)));
  for (let y = yMin; y <= yMax; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      if (y1 === y2) continue;
      if (yc >= Math.min(y1, y2) && yc < Math.max(y1, y2)) {
        xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.round(xs[k])); x <= Math.min(canvas.size - 1, Math.round(xs[k + 1]) - 1); x++) {
        setPx(canvas, x, y, rgb);
      }
    }
  }
}

/** Rounded-rect alpha mask over the background (for the "any" icons). */
function roundedRect(canvas, radius) {
  const { size, data } = canvas;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(x, size - 1 - x);
      const cy = Math.min(y, size - 1 - y);
      if (cx < radius && cy < radius) {
        const dx = radius - cx;
        const dy = radius - cy;
        if (dx * dx + dy * dy > radius * radius) {
          data[(y * size + x) * 4 + 3] = 0; // transparent corner
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* The mark: bold geometric "A" chevron (brand orange on near-black).  */
/* Drawn in a unit box then scaled: apex top-center, two legs, bar.    */
/* ------------------------------------------------------------------ */

function drawMark(canvas, { scale = 0.56, rounded = false }) {
  const s = canvas.size;
  const u = s * scale; // mark bounding box
  const ox = (s - u) / 2;
  const oy = (s - u) / 2;
  const X = (fx) => ox + fx * u;
  const Y = (fy) => oy + fy * u;

  // Left leg
  fillPoly(canvas, [[X(0.06), Y(1)], [X(0.28), Y(1)], [X(0.58), Y(0)], [X(0.42), Y(0)]], BRAND);
  // Right leg
  fillPoly(canvas, [[X(0.72), Y(1)], [X(0.94), Y(1)], [X(0.58), Y(0)], [X(0.42), Y(0)]], BRAND);
  // Crossbar — short, low, echoing the wordmark's bar
  fillPoly(canvas, [[X(0.30), Y(0.66)], [X(0.70), Y(0.66)], [X(0.70), Y(0.80)], [X(0.30), Y(0.80)]], BRAND);

  if (rounded) roundedRect(canvas, Math.round(s * 0.18));
  return canvas;
}

/* ------------------------------------------------------------------ */

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, scale: 0.56, rounded: true },
  { file: "icon-512.png", size: 512, scale: 0.56, rounded: true },
  // Maskable: full-bleed square (no corner mask), mark shrunk into the safe zone.
  { file: "icon-maskable-512.png", size: 512, scale: 0.46, rounded: false },
  { file: "apple-touch-icon.png", size: 180, scale: 0.56, rounded: false },
];

for (const t of targets) {
  const canvas = drawMark(makeCanvas(t.size, OXFORD), { scale: t.scale, rounded: t.rounded });
  const png = encodePng(t.size, t.size, canvas.data);
  writeFileSync(join(OUT_DIR, t.file), png);
  console.log(`wrote public/icons/${t.file} (${t.size}×${t.size}, ${png.length} bytes)`);
}
