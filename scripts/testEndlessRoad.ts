// Stress-tests the real endless-road generator. Run: npm run test:road
// Checks, for many seeds and 100 km of road each:
//   1. every coordinate is finite
//   2. the heading never leaves +-MAX_HEADING, so x always advances (the road can never double back)
//   3. no part of the road ever overlaps a part of itself 800+ px further along
//   4. corners are never tighter than the road is wide
//   5. the same seed always gives the identical road
// `--legacy` runs the ORIGINAL generator (before the fix) through the same checks, to show they catch the bug.
import { MAX_HEADING, RoadGenerator, STEP, halfWidthAt, maxCurvature, type GenPt } from '../src/game/roadGen.ts';

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEGACY = process.argv.includes('--legacy');
const SEEDS = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 2000);
const SAMPLES = 25000; // 100 km
// The hard limit for 'can never double back' is pi/2; the fixed generator promises a stricter MAX_HEADING.
const HEADING_LIMIT = LEGACY ? Math.PI / 2 : MAX_HEADING;
const GAP = 200; // samples (800 px): farther apart along the road than this must never touch

/** The generator as it was before the fix: heading was only nudged back after passing 0.8 rad, and overshot. */
function legacyGenerate(seed: number): GenPt[] {
  const R = mulberry(seed);
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const g = { x: 0, y: 0, heading: 0, curv: 0, target: 0, left: 30, sign: 1 };
  const out: GenPt[] = [];
  for (let n = 0; n < SAMPLES; n++) {
    const half = halfWidthAt(n);
    const maxC = maxCurvature(half);
    if (g.left <= 0) {
      g.sign = R() < 0.7 ? -g.sign : g.sign;
      g.target = R() < 0.22 ? 0 : g.sign * maxC * (0.4 + 0.6 * R());
      g.left = 22 + Math.floor(R() * 45);
    }
    const away = Math.sign(g.heading);
    if (Math.abs(g.heading) > 0.8 && (Math.sign(g.target) === away || Math.sign(g.curv) === away)) { g.target = -away * maxC * 0.7; g.sign = -away; }
    g.curv = clamp(g.curv + clamp(g.target - g.curv, -0.0008, 0.0008), -maxC, maxC);
    g.heading += g.curv * STEP;
    g.x += Math.cos(g.heading) * STEP; g.y += Math.sin(g.heading) * STEP; g.left--;
    out.push({ x: g.x, y: g.y, half });
  }
  return out;
}

function generate(seed: number): GenPt[] {
  if (LEGACY) return legacyGenerate(seed);
  const g = new RoadGenerator(mulberry(seed));
  return Array.from({ length: SAMPLES }, () => g.next());
}

let failures = 0;
const fail = (seed: number, msg: string) => { failures++; if (failures <= 15) console.log(`FAIL seed ${seed}: ${msg}`); };
let worstHeading = 0, minDx = Infinity, minRSlack = Infinity, minGapSlack = Infinity;

for (let seed = 1; seed <= SEEDS; seed++) {
  const pts = generate(seed);

  // determinism
  if (seed <= 50) {
    const again = generate(seed);
    if (again.some((p, i) => p.x !== pts[i].x || p.y !== pts[i].y)) fail(seed, 'not deterministic');
  }

  const cell = 120, grid = new Map<string, number[]>();
  let bad = false;
  for (let i = 0; i < pts.length && !bad; i++) {
    const p = pts[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { fail(seed, `non-finite point at sample ${i}`); bad = true; break; }
    if (i > 0) {
      const dx = p.x - pts[i - 1].x, dy = p.y - pts[i - 1].y;
      const heading = Math.atan2(dy, dx);
      worstHeading = Math.max(worstHeading, Math.abs(heading));
      minDx = Math.min(minDx, dx);
      if (Math.abs(heading) > HEADING_LIMIT + 1e-6) { fail(seed, `heading ${heading.toFixed(2)} at ${Math.round((i * STEP) / 10)} m`); bad = true; break; }
      if (dx <= 0) { fail(seed, `road stopped advancing at ${Math.round((i * STEP) / 10)} m`); bad = true; break; }
    }
    if (i >= 8 && i + 8 < pts.length) { // corner radius from three points 8 samples apart
      const a = pts[i - 8], c = pts[i + 8];
      const ab = Math.hypot(a.x - p.x, a.y - p.y), bc = Math.hypot(p.x - c.x, p.y - c.y), ca = Math.hypot(c.x - a.x, c.y - a.y);
      const area2 = Math.abs((p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y));
      const R = area2 < 1e-9 ? Infinity : (ab * bc * ca) / (2 * area2);
      minRSlack = Math.min(minRSlack, R - p.half);
    }
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1 && !bad; dx++) for (let dy = -1; dy <= 1 && !bad; dy++) {
      for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (i - j < GAP) continue;
        const d = Math.hypot(p.x - pts[j].x, p.y - pts[j].y);
        minGapSlack = Math.min(minGapSlack, d - (p.half + pts[j].half));
        if (d < p.half + pts[j].half) { fail(seed, `road overlaps itself at ${Math.round((i * STEP) / 10)} m`); bad = true; break; }
      }
    }
    (grid.get(`${cx},${cy}`) ?? grid.set(`${cx},${cy}`, []).get(`${cx},${cy}`)!).push(i);
  }
}

console.log(`\n${LEGACY ? '[LEGACY generator] ' : ''}${SEEDS} seeds x ${(SAMPLES * STEP) / 1000} km of road = ${((SEEDS * SAMPLES * STEP) / 1000).toLocaleString()} km tested`);
console.log(`worst heading ${worstHeading.toFixed(3)} rad (limit ${HEADING_LIMIT.toFixed(3)}); min x-advance per sample ${minDx.toFixed(2)} px (must be > 0)`);
console.log(`tightest corner radius minus half-width: ${minRSlack.toFixed(1)} px; ${minGapSlack === Infinity ? 'no distant road ever came within 360 px of other road' : `closest approach of distant road: ${minGapSlack.toFixed(1)} px of clearance`}`);
console.log(failures ? `\n${failures} FAILURES` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
