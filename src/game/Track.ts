import Phaser from 'phaser';
import { sampleClosedSpline, type Pt } from './spline';
import { surfaceFlags } from './surfaces';
import type { TrackDef } from './tracks';

export interface RoadPt extends Pt {
  half: number;
  /** Special surfaces (see surfaces.ts); absent on the endless road. */
  rough?: boolean;
  pad?: boolean;
  zone?: boolean;
}

const ASPHALT = 0x3d405b;
const GRAVEL = 0x6f5b3d;
const DRIFT_ZONE = 0x3b3f73;

export interface BuiltTrack {
  samples: RoadPt[];
  bounds: Phaser.Geom.Rectangle;
}

const MARGIN = 220;
export const KERB = 5;

/**
 * Paints road samples [i0, i1]. Kerbs and asphalt go on separate graphics objects so that,
 * across chunk boundaries, every kerb stays underneath every piece of asphalt.
 */
export function paintRoad(
  kerb: Phaser.GameObjects.Graphics,
  road: Phaser.GameObjects.Graphics,
  rng: Phaser.Math.RandomDataGenerator,
  pts: RoadPt[],
  i0: number,
  i1: number,
): void {
  for (let i = i0; i <= i1; i++) {
    kerb.fillStyle(0x14121f, 0.55).fillCircle(pts[i].x, pts[i].y, pts[i].half + KERB + 1); // dark edge so the road reads against the ground
  }
  for (let i = i0; i <= i1; i++) {
    const stripe = Math.floor(i / 3) % 2 === 1;
    // drift zones have blue kerbs, everything else red
    kerb.fillStyle(stripe ? 0xf1faee : pts[i].zone ? 0x4895ef : 0xe63946).fillCircle(pts[i].x, pts[i].y, pts[i].half + KERB);
  }
  for (let i = i0; i <= i1; i++) {
    road.fillStyle(pts[i].rough ? GRAVEL : pts[i].zone ? DRIFT_ZONE : ASPHALT).fillCircle(pts[i].x, pts[i].y, pts[i].half);
  }
  for (let i = i0; i <= i1; i += pts[i].rough ? 1 : 2) {
    const a = rng.frac() * Math.PI * 2;
    const r = rng.frac() * (pts[i].half - 4);
    const light = rng.frac() > 0.5;
    const color = pts[i].rough ? (light ? 0x8a7550 : 0x57472d) : pts[i].zone ? (light ? 0x4a4f86 : 0x33376a) : light ? 0x464a6b : 0x363955;
    road
      .fillStyle(color, 0.8)
      .fillRect(Math.floor(pts[i].x + Math.cos(a) * r), Math.floor(pts[i].y + Math.sin(a) * r), 1, 1);
  }
  // worn tyre lanes either side of the centre line
  for (let i = i0; i < Math.min(i1, pts.length - 2); i++) {
    if (pts[i].rough) continue;
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const off = a.half * 0.45;
    for (const side of [-1, 1]) {
      const x = a.x - ((b.y - a.y) / len) * off * side;
      const y = a.y + ((b.x - a.x) / len) * off * side;
      road.fillStyle(0x000000, 0.12).fillRect(Math.floor(x) - 1, Math.floor(y) - 1, 2, 2);
    }
  }
  for (let i = i0; i <= i1; i++) {
    if (Math.floor(i / 4) % 2 || pts[i].rough) continue;
    road.fillStyle(pts[i].zone ? 0x9ad1ff : 0xe9c46a).fillRect(Math.floor(pts[i].x) - 1, Math.floor(pts[i].y) - 1, 2, 2);
  }
  paintPads(road, pts, i0, i1);
}

/** Boost pads: a dark strip with yellow chevrons pointing along the road. */
function paintPads(g: Phaser.GameObjects.Graphics, pts: RoadPt[], i0: number, i1: number): void {
  let start = -1;
  for (let i = i0; i <= i1 + 1; i++) {
    const on = i <= i1 && !!pts[i].pad;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const a = pts[start];
      const b = pts[i - 1];
      const len = Math.max(8, Math.hypot(b.x - a.x, b.y - a.y));
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      const w = a.half * 1.5;
      const nx = -dy;
      const ny = dx;
      g.fillStyle(0x1d1b2e).fillPoints([
        { x: a.x + nx * w / 2, y: a.y + ny * w / 2 }, { x: b.x + nx * w / 2, y: b.y + ny * w / 2 },
        { x: b.x - nx * w / 2, y: b.y - ny * w / 2 }, { x: a.x - nx * w / 2, y: a.y - ny * w / 2 },
      ], true);
      for (let k = 0; k < 3; k++) {
        const cx = a.x + dx * len * (0.2 + 0.3 * k);
        const cy = a.y + dy * len * (0.2 + 0.3 * k);
        g.fillStyle(0xffd166).fillTriangle(
          cx + dx * 7, cy + dy * 7,
          cx - dx * 3 + nx * w * 0.38, cy - dy * 3 + ny * w * 0.38,
          cx - dx * 3 - nx * w * 0.38, cy - dy * 3 - ny * w * 0.38,
        );
        g.fillStyle(0x1d1b2e).fillTriangle(
          cx + dx * 3, cy + dy * 3,
          cx - dx * 6 + nx * w * 0.3, cy - dy * 6 + ny * w * 0.3,
          cx - dx * 6 - nx * w * 0.3, cy - dy * 6 - ny * w * 0.3,
        );
      }
      start = -1;
    }
  }
}

/** Checkered line across the road at `a`, perpendicular to the direction a -> b. */
export function paintStartLine(g: Phaser.GameObjects.Graphics, a: Pt, b: Pt, width: number): void {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  const cell = 4;
  const across = Math.floor(width / cell);
  for (let c = 0; c < across; c++) {
    for (let r = 0; r < 2; r++) {
      const off = (c - across / 2 + 0.5) * cell;
      const px = a.x + nx * off + Math.cos(ang) * (r - 1) * cell;
      const py = a.y + ny * off + Math.sin(ang) * (r - 1) * cell;
      g.fillStyle((c + r) % 2 ? 0xffffff : 0x14121f).fillRect(Math.floor(px) - 2, Math.floor(py) - 2, cell, cell);
    }
  }
}

/** Picks a scenery sprite for the theme: mostly the tree, sometimes a bush or a rock. */
export function decoKey(theme: string, roll: number): string {
  return roll < 0.55 ? `deco-${theme}` : roll < 0.8 ? `deco-${theme}-b` : `deco-${theme}-c`;
}

/**
 * Draws a Graphics object once into render textures (tiled, so no texture is bigger than `tile` px) and removes it.
 * A Graphics object re-runs every one of its drawing commands on every frame, and a road has tens of thousands of
 * them, which is what makes slow computers lag. A texture costs the same to draw however much is painted on it.
 * `area` is the world rectangle that the graphics cover.
 */
export function bakeGraphics(
  scene: Phaser.Scene,
  gfx: Phaser.GameObjects.Graphics,
  area: Phaser.Geom.Rectangle,
  depth: number,
  tile = 1024,
): Phaser.GameObjects.RenderTexture[] {
  const out: Phaser.GameObjects.RenderTexture[] = [];
  const x0 = Math.floor(area.x);
  const y0 = Math.floor(area.y);
  const x1 = Math.ceil(area.right);
  const y1 = Math.ceil(area.bottom);
  for (let y = y0; y < y1; y += tile) {
    for (let x = x0; x < x1; x += tile) {
      const rt = scene.add.renderTexture(x, y, Math.min(tile, x1 - x), Math.min(tile, y1 - y)).setOrigin(0).setDepth(depth);
      rt.draw(gfx, -x, -y);
      out.push(rt);
    }
  }
  gfx.destroy();
  return out;
}

/** World rectangle covering road samples [i0, i1] and their kerbs. */
export function roadArea(pts: RoadPt[], i0: number, i1: number): Phaser.Geom.Rectangle {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const r = pts[i].half + KERB + 4;
    x0 = Math.min(x0, pts[i].x - r);
    y0 = Math.min(y0, pts[i].y - r);
    x1 = Math.max(x1, pts[i].x + r);
    y1 = Math.max(y1, pts[i].y + r);
  }
  return new Phaser.Geom.Rectangle(x0, y0, x1 - x0, y1 - y0);
}

export function treeDepth(y: number): number {
  return 20 + y * 1e-6;
}

export function buildTrack(scene: Phaser.Scene, def: TrackDef): BuiltTrack {
  const raw = sampleClosedSpline(def.points, 4, def.roadWidth);
  const flags = surfaceFlags(raw.length, def);
  const samples: RoadPt[] = raw.map((p, i) => ({ x: p.x, y: p.y, half: p.w / 2, ...flags[i] }));

  const xs = samples.map((p) => p.x);
  const ys = samples.map((p) => p.y);
  const x0 = Math.min(...xs) - MARGIN;
  const y0 = Math.min(...ys) - MARGIN;
  const bounds = new Phaser.Geom.Rectangle(x0, y0, Math.max(...xs) + MARGIN - x0, Math.max(...ys) + MARGIN - y0);

  // Deterministic scatter so a track looks the same every run.
  const rng = new Phaser.Math.RandomDataGenerator([def.id]);

  scene.add.tileSprite(bounds.x, bounds.y, bounds.width, bounds.height, `ground-${def.theme}`).setOrigin(0).setDepth(0);

  const nearRoad = (x: number, y: number, clearance: number): boolean => {
    for (let i = 0; i < samples.length; i += 2) {
      const dx = samples[i].x - x;
      const dy = samples[i].y - y;
      if (dx * dx + dy * dy < (samples[i].half + clearance) ** 2) return true;
    }
    return false;
  };

  for (let i = 0; i < 110; i++) {
    const x = Math.floor(bounds.x + rng.frac() * bounds.width);
    const y = Math.floor(bounds.y + rng.frac() * bounds.height);
    if (nearRoad(x, y, 14)) continue;
    scene.add.image(x, y, `patch-${def.theme}`).setDepth(0.3);
  }

  const deco = scene.add.graphics().setDepth(0.5);
  const flowerColors: Record<string, number[]> = {
    grass: [0xf4a261, 0xe9c46a, 0xf1faee, 0xe76f51],
    desert: [0xa8743a, 0x8c5e2b],
    snow: [0xa8c5d6, 0xffffff],
    night: [0x3a7d5c, 0x5b8fb9],
  };
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(bounds.x + rng.frac() * bounds.width);
    const y = Math.floor(bounds.y + rng.frac() * bounds.height);
    if (nearRoad(x, y, 14)) continue;
    deco.fillStyle(rng.pick(flowerColors[def.theme])).fillRect(x, y, 1, 1);
  }

  const kerb = scene.add.graphics().setDepth(1);
  const road = scene.add.graphics().setDepth(1.1);
  paintRoad(kerb, road, rng, samples, 0, samples.length - 1);
  paintStartLine(road, samples[0], samples[2], samples[0].half * 2);
  // Everything above is fixed for the whole race: bake it into textures instead of redrawing it every frame.
  bakeGraphics(scene, deco, bounds, 0.5);
  const area = roadArea(samples, 0, samples.length - 1);
  bakeGraphics(scene, kerb, area, 1);
  bakeGraphics(scene, road, area, 1.1);

  const trees: Pt[] = [];
  for (let i = 0; i < 90; i++) {
    const x = bounds.x + rng.frac() * bounds.width;
    const y = bounds.y + rng.frac() * bounds.height;
    if (!nearRoad(x, y, 28)) trees.push({ x, y });
  }
  trees.forEach((t) => scene.add.image(Math.floor(t.x), Math.floor(t.y), decoKey(def.theme, rng.frac())).setOrigin(0.5, 0.9).setDepth(treeDepth(t.y)));

  return { samples, bounds };
}
