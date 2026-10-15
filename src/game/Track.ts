import Phaser from 'phaser';
import { sampleClosedSpline, type Pt } from './spline';
import type { TrackDef } from './tracks';

export interface RoadPt extends Pt {
  half: number;
}

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
    kerb.fillStyle(Math.floor(i / 3) % 2 ? 0xf1faee : 0xe63946).fillCircle(pts[i].x, pts[i].y, pts[i].half + KERB);
  }
  for (let i = i0; i <= i1; i++) {
    road.fillStyle(0x3d405b).fillCircle(pts[i].x, pts[i].y, pts[i].half);
  }
  for (let i = i0; i <= i1; i += 2) {
    const a = rng.frac() * Math.PI * 2;
    const r = rng.frac() * (pts[i].half - 4);
    road
      .fillStyle(rng.frac() > 0.5 ? 0x464a6b : 0x363955, 0.8)
      .fillRect(Math.floor(pts[i].x + Math.cos(a) * r), Math.floor(pts[i].y + Math.sin(a) * r), 1, 1);
  }
  for (let i = i0; i <= i1; i++) {
    if (Math.floor(i / 4) % 2) continue;
    road.fillStyle(0xe9c46a).fillRect(Math.floor(pts[i].x) - 1, Math.floor(pts[i].y) - 1, 2, 2);
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

export function treeDepth(y: number): number {
  return 20 + y * 1e-6;
}

export function buildTrack(scene: Phaser.Scene, def: TrackDef): BuiltTrack {
  const samples: RoadPt[] = sampleClosedSpline(def.points, 4, def.roadWidth).map((p) => ({ x: p.x, y: p.y, half: p.w / 2 }));

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

  const trees: Pt[] = [];
  for (let i = 0; i < 90; i++) {
    const x = bounds.x + rng.frac() * bounds.width;
    const y = bounds.y + rng.frac() * bounds.height;
    if (!nearRoad(x, y, 28)) trees.push({ x, y });
  }
  trees.forEach((t) => scene.add.image(Math.floor(t.x), Math.floor(t.y), `deco-${def.theme}`).setOrigin(0.5, 0.9).setDepth(treeDepth(t.y)));

  return { samples, bounds };
}
