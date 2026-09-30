// Generates the 1024x1024 application icon source.
//
// The icon is rendered procedurally instead of shipping a binary blob so the
// artwork is reviewable in a diff and can be regenerated on any machine:
//
//     node scripts/generate-icon.mjs
//     npx tauri icon src-tauri/icons/source.png -o src-tauri/icons
//
// The motif is a Markdown "M" beside a downward arrow — the mark users already
// associate with .md files — on a rounded gradient tile.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 1024;
const SAMPLES = 3; // supersampling factor per axis
const RADIUS = 180;

const GRADIENT_FROM = [0x25, 0x63, 0xeb];
const GRADIENT_TO = [0x7c, 0x3a, 0xed];
const GLYPH = [0xff, 0xff, 0xff];

/** Classic Markdown "M": two outer stems with a V notch in the middle. */
const M_GLYPH = [
  [0.13, 0.71],
  [0.13, 0.3],
  [0.232, 0.3],
  [0.35, 0.505],
  [0.468, 0.3],
  [0.57, 0.3],
  [0.57, 0.71],
  [0.468, 0.71],
  [0.468, 0.44],
  [0.35, 0.645],
  [0.232, 0.44],
  [0.232, 0.71],
];

/** Downward arrow: a shaft plus a triangular head. */
const ARROW_SHAFT = [
  [0.7, 0.28],
  [0.788, 0.28],
  [0.788, 0.55],
  [0.7, 0.55],
];

const ARROW_HEAD = [
  [0.62, 0.5],
  [0.868, 0.5],
  [0.744, 0.75],
];

/** Ray-casting point-in-polygon test. Points are in normalised coordinates. */
function inPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Signed distance to a rounded rectangle centred on the tile. */
function roundedRectDistance(px, py, half, radius) {
  const dx = Math.abs(px) - half + radius;
  const dy = Math.abs(py) - half + radius;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

const glyphPolygons = [M_GLYPH, ARROW_SHAFT, ARROW_HEAD];

const raw = Buffer.alloc(SIZE * SIZE * 4);
const half = 0.5;
const step = 1 / (SIZE * SAMPLES);
const sampleCount = SAMPLES * SAMPLES;

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let background = 0;
    let glyph = 0;

    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const x = (px * SAMPLES + sx + 0.5) * step;
        const y = (py * SAMPLES + sy + 0.5) * step;

        if (roundedRectDistance(x - half, y - half, half, RADIUS / SIZE) <= 0) {
          background += 1;
          for (const polygon of glyphPolygons) {
            if (inPolygon(x, y, polygon)) {
              glyph += 1;
              break;
            }
          }
        }
      }
    }

    const alpha = background / sampleCount;
    const glyphMix = background > 0 ? glyph / background : 0;

    // Diagonal gradient across the tile.
    const t = (px + py) / (2 * (SIZE - 1));
    const base = [
      GRADIENT_FROM[0] + (GRADIENT_TO[0] - GRADIENT_FROM[0]) * t,
      GRADIENT_FROM[1] + (GRADIENT_TO[1] - GRADIENT_FROM[1]) * t,
      GRADIENT_FROM[2] + (GRADIENT_TO[2] - GRADIENT_FROM[2]) * t,
    ];

    const offset = (py * SIZE + px) * 4;
    for (let channel = 0; channel < 3; channel++) {
      raw[offset + channel] = Math.round(base[channel] + (GLYPH[channel] - base[channel]) * glyphMix);
    }
    raw[offset + 3] = Math.round(alpha * 255);
  }
}

/** Minimal PNG encoder: one IHDR, one IDAT of filtered scanlines, one IEND. */
function encodePng(width, height, rgba) {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buffer) => {
    let c = -1;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };

  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "src-tauri", "icons", "source.png");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, encodePng(SIZE, SIZE, raw));
console.log(`wrote ${target}`);
