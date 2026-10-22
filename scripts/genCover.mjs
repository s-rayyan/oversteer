// Draws the store cover image (art/cover.png) in the game's own pixel style: `node scripts/genCover.mjs`.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 480, H = 270, SCALE = 4; // drawn at game resolution, enlarged 4x to 1920x1080
const px = new Uint8Array(W * H * 3);
const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const set = (x, y, c, a = 1) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3, [r, g, b] = hex(c);
  px[i] = px[i] * (1 - a) + r * a; px[i + 1] = px[i + 1] * (1 - a) + g * a; px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
const rect = (x, y, w, h, c, a = 1) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c, a); };
const disc = (cx, cy, r, c, a = 1) => {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c, a);
};
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// Ground: dark grass with tufts and flowers.
rect(0, 0, W, H, 0x1b3b36);
for (let i = 0; i < 1400; i++) set(rnd() * W, rnd() * H, rnd() < 0.5 ? 0x22463f : 0x17332f);
for (let i = 0; i < 160; i++) set(rnd() * W, rnd() * H, [0xffd166, 0xf1faee, 0xff8fa3][i % 3], 0.8);

// Road: a bezier sweeping across the picture, kerbs first so the tarmac covers their inner edge.
const B = [[-40, 245], [170, 285], [250, 60], [530, 150]];
const bez = (t) => {
  const u = 1 - t;
  return [0, 1].map((k) => u ** 3 * B[0][k] + 3 * u * u * t * B[1][k] + 3 * u * t * t * B[2][k] + t ** 3 * B[3][k]);
};
const N = 1400, HALF = 27;
for (let i = 0; i <= N; i++) { const [x, y] = bez(i / N); disc(x, y, HALF + 4, Math.floor(i / 22) % 2 ? 0xf1faee : 0xe63946); }
for (let i = 0; i <= N; i++) { const [x, y] = bez(i / N); disc(x, y, HALF, 0x3b3b55); }
for (let i = 0; i <= N; i++) { const [x, y] = bez(i / N); if (Math.floor(i / 26) % 2) disc(x, y, 1, 0xc9d1e3, 0.55); }
for (let i = 0; i < 2600; i++) { const [x, y] = bez(rnd()); set(x + (rnd() - 0.5) * 2 * HALF, y + (rnd() - 0.5) * 2 * HALF, rnd() < 0.5 ? 0x45456a : 0x33334b, 0.6); }

// The car sits on the curve at T and is turned past the road direction: oversteer.
const T = 0.56;
const [cx, cy] = bez(T), [ax, ay] = bez(T + 0.01);
const road = Math.atan2(ay - cy, ax - cx), ang = road + 0.62;

// Skid marks: two tyre trails that start straight and sweep into the slide.
for (let side = -1; side <= 1; side += 2) {
  for (let i = 0; i <= 420; i++) {
    const t = T - 0.3 * (1 - i / 420) ** 1.0;
    const [x, y] = bez(Math.max(0.02, t)), [x2, y2] = bez(Math.max(0.02, t) + 0.005);
    const d = Math.atan2(y2 - y, x2 - x), k = (i / 420) ** 2;
    const off = side * (5 + 7 * k);
    set(x + Math.cos(d + Math.PI / 2) * off, y + Math.sin(d + Math.PI / 2) * off, 0x15151f, 0.35 + 0.55 * k);
  }
}

// Tyre smoke: soft puffs thrown out behind the rear wheels.
for (let i = 0; i < 60; i++) {
  const back = ang + Math.PI + (rnd() - 0.5) * 0.9, dist = 12 + rnd() * 46;
  const x = cx + Math.cos(back) * dist, y = cy + Math.sin(back) * dist, r = 2 + dist / 9 + rnd() * 2;
  disc(x, y, r, 0xe8ecf4, 0.26 * (1 - dist / 70));
}

// Headlight beam.
for (let i = 0; i < 90; i++) for (let j = -i / 3; j <= i / 3; j += 0.7) {
  set(cx + Math.cos(ang) * (14 + i) - Math.sin(ang) * j, cy + Math.sin(ang) * (14 + i) + Math.cos(ang) * j, 0xfff1b8, 0.07 * (1 - i / 90));
}

// The car (Rocket, facing +x), drawn from the game's own sprite recipe at 3x and rotated.
const CW = 18, CH = 8, CS = 3;
const spr = Array.from({ length: CH }, () => Array(CW).fill(null));
const sr = (c, x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) spr[y + j][x + i] = c; };
const body = 0xf1faee, dark = 0xc4cbc8;
for (const wx of [2, 12]) { sr(0x14121f, wx, 0, 3, 1); sr(0x14121f, wx, CH - 1, 3, 1); }
sr(dark, 1, 1, CW - 2, CH - 2); sr(body, 2, 2, CW - 4, CH - 4); sr(0xffffff, 3, 2, CW - 6, 1); sr(0xb7bfbb, 3, CH - 3, CW - 6, 1);
sr(0xe63946, 2, CH / 2, CW - 4, 1);
sr(0x1d3557, 9, 2, 3, CH - 4); sr(0x457b9d, 9, 2, 1, CH - 4); sr(0x1d3557, 4, 2, 2, CH - 4);
sr(0xffd166, CW - 2, 2, 1, 1); sr(0xffd166, CW - 2, CH - 3, 1, 1); sr(0xfff1b8, CW - 1, 2, 1, 1); sr(0xfff1b8, CW - 1, CH - 3, 1, 1);
sr(0xff6b6b, 1, 2, 1, 1); sr(0xff6b6b, 1, CH - 3, 1, 1); sr(0x14121f, 0, 2, 1, CH - 4);
// shadow, then sprite by inverse mapping
const co = Math.cos(ang), si = Math.sin(ang), R = CW * CS;
for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
  const u = (x * co + y * si) / CS + CW / 2, v = (-x * si + y * co) / CS + CH / 2;
  const iu = Math.floor(u), iv = Math.floor(v);
  if (iu < 0 || iv < 0 || iu >= CW || iv >= CH) continue;
  if (spr[iv][iu] != null) set(cx + x + 3, cy + y + 4, 0x0d0d18, 0.0); // (shadow handled below)
}
for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
  const u = (x * co + y * si) / CS + CW / 2, v = (-x * si + y * co) / CS + CH / 2;
  const iu = Math.floor(u), iv = Math.floor(v);
  if (iu >= 0 && iv >= 0 && iu < CW && iv < CH && spr[iv][iu] != null) set(cx + x + 3, cy + y + 4, 0x0d0d18, 0.35);
}
for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
  const u = (x * co + y * si) / CS + CW / 2, v = (-x * si + y * co) / CS + CH / 2;
  const iu = Math.floor(u), iv = Math.floor(v);
  if (iu >= 0 && iv >= 0 && iu < CW && iv < CH && spr[iv][iu] != null) set(cx + x, cy + y, spr[iv][iu]);
}

// Vignette.
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2));
  if (d > 0.7) set(x, y, 0x0a0912, Math.min(0.6, (d - 0.7) * 0.9));
}

// Title in a 5x7 pixel font.
const G = {
  A: '01110 10001 10001 11111 10001 10001 10001', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
  G: '01111 10000 10000 10011 10001 10001 01111', I: '01110 00100 00100 00100 00100 00100 01110',
  L: '10000 10000 10000 10000 10000 10000 11111', M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001', O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  V: '10001 10001 10001 10001 10001 01010 00100', X: '10001 10001 01010 00100 01010 10001 10001',
};
const text = (s, x, y, sc, c, shadow) => {
  for (const ch of s) {
    const g = G[ch];
    if (g) g.split(' ').forEach((row, j) => [...row].forEach((bit, i) => {
      if (bit === '1') { if (shadow) rect(x + i * sc + sc, y + j * sc + sc, sc, sc, shadow); rect(x + i * sc, y + j * sc, sc, sc, c); }
    }));
    x += 6 * sc;
  }
};
text('OVERSTEER', 22, 20, 6, 0xffd166, 0x14121f);
text('A PIXEL DRIFTING GAME', 24, 72, 2, 0xf1faee, 0x14121f);

// Enlarge 4x (nearest) and write a PNG.
const OW = W * SCALE, OH = H * SCALE, raw = Buffer.alloc((OW * 3 + 1) * OH);
for (let y = 0; y < OH; y++) {
  const o = y * (OW * 3 + 1); raw[o] = 0;
  for (let x = 0; x < OW; x++) {
    const i = (Math.floor(y / SCALE) * W + Math.floor(x / SCALE)) * 3;
    raw[o + 1 + x * 3] = px[i]; raw[o + 2 + x * 3] = px[i + 1]; raw[o + 3 + x * 3] = px[i + 2];
  }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(OW, 0); ihdr.writeUInt32BE(OH, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(new URL('../art/cover.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log(`art/cover.png ${OW}x${OH}`);
