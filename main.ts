// A procedural cutest-picture-01 entry (Node 22, standard library only).
// Draws a chubby baby bunny with big glossy eyes, blush cheeks, whiskers and a
// little daisy, on a soft pastel sky, and writes it to /output/entry.png as a
// 1024x1024 PNG. Pure pixel math: no assets, no network, no randomness, so two
// runs produce byte-identical output.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// Frame buffer (float RGB, 0..255) with "over" compositing
// ---------------------------------------------------------------------------

const img = new Float32Array(W * H * 3);

function over(x, y, r, g, b, a) {
  if (a <= 0) return;
  if (a > 1) a = 1;
  const i = (y * W + x) * 3;
  img[i] = lerp(img[i], r, a);
  img[i + 1] = lerp(img[i + 1], g, a);
  img[i + 2] = lerp(img[i + 2], b, a);
}

// Paint a shape over its bounding box. alphaFn(px, py) returns coverage 0..1.
function fill(x0, y0, x1, y1, r, g, b, alphaFn) {
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W - 1, Math.ceil(x1));
  y1 = Math.min(H - 1, Math.ceil(y1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const a = alphaFn(x + 0.5, y + 0.5);
      if (a > 0) over(x, y, r, g, b, a);
    }
  }
}

// ---------------------------------------------------------------------------
// Signed distance functions (pixel units, y down)
// ---------------------------------------------------------------------------

function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

function sdEllipse(x, y, cx, cy, rx, ry) {
  const kx = (x - cx) / rx;
  const ky = (y - cy) / ry;
  return (Math.hypot(kx, ky) - 1) * Math.min(rx, ry);
}

function sdCapsule(x, y, ax, ay, bx, by, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((x - ax) * dx + (y - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) - r;
}

function sdArc(x, y, cx, cy, r, a0, a1) {
  const dx = x - cx;
  const dy = y - cy;
  const TAU = Math.PI * 2;
  let a = Math.atan2(dy, dx);
  while (a < a0) a += TAU;
  while (a >= a0 + TAU) a -= TAU;
  if (a <= a1) return Math.abs(Math.hypot(dx, dy) - r);
  const ex0 = cx + r * Math.cos(a0);
  const ey0 = cy + r * Math.sin(a0);
  const ex1 = cx + r * Math.cos(a1);
  const ey1 = cy + r * Math.sin(a1);
  return Math.min(Math.hypot(x - ex0, y - ey0), Math.hypot(x - ex1, y - ey1));
}

// Crisp filled-shape coverage from an SDF: 1 inside, 0 outside, ~1.5px AA.
const edgeAA = (d) => clamp(0.5 - d / 1.5, 0, 1);
// Stroke coverage: d is distance to the centreline, w the stroke width.
const strokeAA = (d, w) => clamp((w / 2 + 0.75 - d) / 1.5, 0, 1);

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const CREAM = [255, 251, 245]; // bunny fur
const OUTLINE = [229, 195, 172]; // soft warm outline
const INNER_EAR = [255, 185, 201]; // pink inner ear
const EYE = [46, 31, 26]; // dark brown eyes
const EYE_RIM = [107, 74, 63]; // lighter rim around eyes
const NOSE = [244, 146, 172];
const MOUTH = [122, 74, 60];
const BLUSH = [255, 158, 176];
const WHISKER = [216, 180, 156];
const PETAL = [255, 194, 209];
const FLOWER_CENTER = [255, 184, 77];
const LEAF = [156, 203, 142];
const SHADOW = [232, 180, 160];
const WHITE = [255, 255, 255];

// ---------------------------------------------------------------------------
// Background: pastel gradient + warm glow
// ---------------------------------------------------------------------------

{
  const top = [255, 207, 224];
  const bottom = [255, 245, 230];
  for (let y = 0; y < H; y++) {
    const t = Math.pow(y / (H - 1), 1.1);
    const r = lerp(top[0], bottom[0], t);
    const g = lerp(top[1], bottom[1], t);
    const b = lerp(top[2], bottom[2], t);
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      img[i] = r;
      img[i + 1] = g;
      img[i + 2] = b;
    }
  }
  // Soft white glow behind the subject.
  fill(0, 0, W - 1, H - 1, 255, 255, 255, (x, y) => {
    const d = Math.hypot(x - 512, y - 500) / 520;
    return 0.32 * (1 - smoothstep(0.15, 1, d));
  });
}

// ---------------------------------------------------------------------------
// Clouds: unions of circles with a soft edge
// ---------------------------------------------------------------------------

function cloud(cx, cy, s, alpha) {
  const circles = [
    [-58, 8, 46],
    [0, -12, 60],
    [58, 10, 44],
    [-20, 16, 50],
    [25, 18, 48],
  ];
  const R = 120 * s;
  fill(cx - R, cy - R, cx + R, cy + R, 255, 255, 255, (x, y) => {
    let d = Infinity;
    for (const [ox, oy, r] of circles) {
      d = Math.min(d, sdCircle(x, y, cx + ox * s, cy + oy * s, r * s));
    }
    return alpha * clamp(0.5 - d / 6, 0, 1);
  });
}

cloud(175, 150, 1.0, 0.95);
cloud(862, 138, 0.85, 0.95);
cloud(130, 430, 0.62, 0.9);

// ---------------------------------------------------------------------------
// Sparkles: two crossed thin ellipses + a soft glow
// ---------------------------------------------------------------------------

function sparkle(cx, cy, s, r, g, b) {
  fill(cx - 3 * s, cy - 3 * s, cx + 3 * s, cy + 3 * s, r, g, b, (x, y) => {
    const d = Math.hypot(x - cx, y - cy) / (2.4 * s);
    return 0.35 * (1 - smoothstep(0.2, 1, d));
  });
  fill(cx - s, cy - s, cx + s, cy + s, r, g, b, (x, y) => {
    const d = Math.min(
      sdEllipse(x, y, cx, cy, 0.22 * s, s),
      sdEllipse(x, y, cx, cy, s, 0.22 * s),
    );
    return edgeAA(d);
  });
}

sparkle(105, 262, 20, 255, 217, 138);
sparkle(938, 238, 24, 255, 217, 138);
sparkle(888, 475, 16, 255, 255, 255);
sparkle(142, 500, 15, 255, 255, 255);
sparkle(795, 92, 13, 255, 217, 138);

// ---------------------------------------------------------------------------
// Ground shadow
// ---------------------------------------------------------------------------

fill(180, 880, 844, 980, ...SHADOW, (x, y) => {
  const k = Math.hypot((x - 512) / 300, (y - 930) / 34);
  return 0.35 * (1 - smoothstep(0.55, 1, k));
});

// ---------------------------------------------------------------------------
// Ears (behind the head): outline, fill, inner ear
// ---------------------------------------------------------------------------

const EAR_L = { ax: 440, ay: 385, bx: 365, by: 95, r: 62 };
const EAR_R = { ax: 584, ay: 385, bx: 659, by: 95, r: 62 };

function ear(e, inner) {
  const pad = e.r + 10;
  const x0 = Math.min(e.ax, e.bx) - pad;
  const x1 = Math.max(e.ax, e.bx) + pad;
  const y0 = Math.min(e.ay, e.by) - pad;
  const y1 = Math.max(e.ay, e.by) + pad;
  fill(x0, y0, x1, y1, ...OUTLINE, (x, y) =>
    edgeAA(sdCapsule(x, y, e.ax, e.ay, e.bx, e.by, e.r + 7)),
  );
  fill(x0, y0, x1, y1, ...CREAM, (x, y) =>
    edgeAA(sdCapsule(x, y, e.ax, e.ay, e.bx, e.by, e.r)),
  );
  fill(x0, y0, x1, y1, ...INNER_EAR, (x, y) =>
    edgeAA(sdCapsule(x, y, inner.ax, inner.ay, inner.bx, inner.by, inner.r)),
  );
}

ear(EAR_L, { ax: 445, ay: 350, bx: 378, by: 145, r: 33 });
ear(EAR_R, { ax: 579, ay: 350, bx: 646, by: 145, r: 33 });

// ---------------------------------------------------------------------------
// Head / body: one big chubby ellipse with outline
// ---------------------------------------------------------------------------

const HEAD = { cx: 512, cy: 615, rx: 295, ry: 285 };

fill(
  HEAD.cx - HEAD.rx - 10, HEAD.cy - HEAD.ry - 10,
  HEAD.cx + HEAD.rx + 10, HEAD.cy + HEAD.ry + 10,
  ...OUTLINE,
  (x, y) => edgeAA(sdEllipse(x, y, HEAD.cx, HEAD.cy, HEAD.rx + 7, HEAD.ry + 7)),
);
fill(
  HEAD.cx - HEAD.rx - 10, HEAD.cy - HEAD.ry - 10,
  HEAD.cx + HEAD.rx + 10, HEAD.cy + HEAD.ry + 10,
  ...CREAM,
  (x, y) => edgeAA(sdEllipse(x, y, HEAD.cx, HEAD.cy, HEAD.rx, HEAD.ry)),
);

// Subtle belly patch.
fill(330, 620, 694, 900, ...WHITE, (x, y) => {
  const k = Math.hypot((x - 512) / 170, (y - 770) / 130);
  return 0.5 * (1 - smoothstep(0.6, 1, k));
});

// ---------------------------------------------------------------------------
// Blush cheeks (soft)
// ---------------------------------------------------------------------------

function blush(cx, cy) {
  fill(cx - 72, cy - 46, cx + 72, cy + 46, ...BLUSH, (x, y) => {
    const k = Math.hypot((x - cx) / 58, (y - cy) / 33);
    return 0.56 * (1 - smoothstep(0.55, 1, k));
  });
}

blush(340, 668);
blush(684, 668);

// ---------------------------------------------------------------------------
// Whiskers (thin, subtle)
// ---------------------------------------------------------------------------

function whisker(ax, ay, bx, by) {
  const pad = 6;
  fill(
    Math.min(ax, bx) - pad, Math.min(ay, by) - pad,
    Math.max(ax, bx) + pad, Math.max(ay, by) + pad,
    ...WHISKER,
    (x, y) => 0.85 * strokeAA(sdCapsule(x, y, ax, ay, bx, by, 0), 4),
  );
}

whisker(352, 614, 258, 598);
whisker(350, 640, 254, 646);
whisker(354, 664, 262, 688);
whisker(672, 614, 766, 598);
whisker(674, 640, 770, 646);
whisker(670, 664, 762, 688);

// ---------------------------------------------------------------------------
// Eyes: rim, dark pupil, glossy highlights
// ---------------------------------------------------------------------------

function eye(cx, cy) {
  const rx = 48;
  const ry = 60;
  fill(cx - rx - 4, cy - ry - 4, cx + rx + 4, cy + ry + 4, ...EYE_RIM, (x, y) =>
    edgeAA(sdEllipse(x, y, cx, cy, rx, ry)),
  );
  fill(cx - rx, cy - ry, cx + rx, cy + ry, ...EYE, (x, y) =>
    edgeAA(sdEllipse(x, y, cx, cy, rx - 5, ry - 5)),
  );
  // Big upper-left highlight.
  fill(cx - 30, cy - 45, cx + 2, cy - 13, ...WHITE, (x, y) =>
    edgeAA(sdCircle(x, y, cx - 14, cy - 29, 15)),
  );
  // Small lower-right highlight.
  fill(cx + 6, cy + 14, cx + 30, cy + 38, ...WHITE, (x, y) =>
    0.9 * edgeAA(sdCircle(x, y, cx + 18, cy + 26, 7.5)),
  );
  // Soft bottom reflection.
  fill(cx - 30, cy + 18, cx + 30, cy + 52, ...WHITE, (x, y) => {
    const k = Math.hypot((x - cx) / 26, (y - (cy + 36)) / 12);
    return 0.22 * (1 - smoothstep(0.5, 1, k));
  });
}

eye(402, 575);
eye(622, 575);

// ---------------------------------------------------------------------------
// Nose + bunny smile (omega mouth)
// ---------------------------------------------------------------------------

fill(488, 632, 536, 668, ...NOSE, (x, y) =>
  edgeAA(sdEllipse(x, y, 512, 650, 20, 14)),
);
fill(500, 636, 516, 650, ...WHITE, (x, y) =>
  0.6 * edgeAA(sdCircle(x, y, 507, 643, 5)),
);

// Mouth stem from the nose down to the smile.
fill(506, 658, 518, 678, ...MOUTH, (x, y) =>
  strokeAA(sdCapsule(x, y, 512, 660, 512, 674, 0), 5.5),
);

// Two arcs forming the omega smile.
for (const ccx of [491, 533]) {
  fill(ccx - 30, 650, ccx + 30, 700, ...MOUTH, (x, y) =>
    strokeAA(sdArc(x, y, ccx, 664, 21, 0.1 * Math.PI, 0.9 * Math.PI), 5.5),
  );
}

// ---------------------------------------------------------------------------
// Paws: two little feet at the bottom + toe lines
// ---------------------------------------------------------------------------

function paw(cx, cy) {
  fill(cx - 70, cy - 55, cx + 70, cy + 55, ...OUTLINE, (x, y) =>
    edgeAA(sdEllipse(x, y, cx, cy, 63, 47)),
  );
  fill(cx - 70, cy - 55, cx + 70, cy + 55, ...CREAM, (x, y) =>
    edgeAA(sdEllipse(x, y, cx, cy, 56, 40)),
  );
  for (const ox of [-14, 14]) {
    fill(cx + ox - 5, cy - 16, cx + ox + 5, cy + 10, 205, 168, 142, (x, y) =>
      strokeAA(sdCapsule(x, y, cx + ox, cy - 14, cx + ox, cy + 8, 0), 4.5),
    );
  }
}

paw(438, 862);
paw(586, 862);

// ---------------------------------------------------------------------------
// Daisy charm tucked at the base of the right ear
// ---------------------------------------------------------------------------

{
  const fx = 660;
  const fy = 312;
  // Two small leaves behind the petals.
  for (const [lx, ly, ang] of [
    [633, 336, -35],
    [687, 334, 35],
  ]) {
    const rad = (ang * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    fill(lx - 26, ly - 26, lx + 26, ly + 26, ...LEAF, (x, y) => {
      const dx = x - lx;
      const dy = y - ly;
      const rx = dx * cos + dy * sin;
      const ry = -dx * sin + dy * cos;
      return edgeAA(sdEllipse(rx, ry, 0, 0, 21, 9.5));
    });
  }
  // Five petals.
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const px = fx + 24 * Math.cos(a);
    const py = fy + 24 * Math.sin(a);
    fill(px - 22, py - 22, px + 22, py + 22, ...PETAL, (x, y) =>
      edgeAA(sdCircle(x, y, px, py, 18)),
    );
  }
  // Yellow centre.
  fill(fx - 19, fy - 19, fx + 19, fy + 19, ...FLOWER_CENTER, (x, y) =>
    edgeAA(sdCircle(x, y, fx, fy, 15)),
  );
  fill(fx - 8, fy - 10, fx + 4, fy + 2, ...WHITE, (x, y) =>
    0.7 * edgeAA(sdCircle(x, y, fx - 4, fy - 5, 4.5)),
  );
}

// ---------------------------------------------------------------------------
// PNG encoding (deterministic: fixed filters by heuristic, zlib level 9)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePNG() {
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0, j = 0; i < img.length; i += 3, j += 4) {
    rgba[j] = Math.round(clamp(img[i], 0, 255));
    rgba[j + 1] = Math.round(clamp(img[i + 1], 0, 255));
    rgba[j + 2] = Math.round(clamp(img[i + 2], 0, 255));
    rgba[j + 3] = 255;
  }
  const stride = W * 4;
  const raw = Buffer.alloc(H * (stride + 1));
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const candidates = [];
    for (let f = 0; f < 5; f++) {
      const out = Buffer.alloc(stride);
      for (let i = 0; i < stride; i++) {
        const left = i >= 4 ? row[i - 4] : 0;
        const up = prev[i];
        const upLeft = i >= 4 ? prev[i - 4] : 0;
        let pred = 0;
        if (f === 1) pred = left;
        else if (f === 2) pred = up;
        else if (f === 3) pred = (left + up) >> 1;
        else if (f === 4) pred = paeth(left, up, upLeft);
        out[i] = (row[i] - pred) & 0xff;
      }
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const s = out[i] < 128 ? out[i] : out[i] - 256;
        score += Math.abs(s);
      }
      candidates.push({ f, out, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];
    const off = y * (stride + 1);
    raw[off] = best.f;
    best.out.copy(raw, off + 1);
    row.copy(prev);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return png;
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePNG();
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote ${png.length} bytes to ${join(outDir, 'entry.png')}`);
