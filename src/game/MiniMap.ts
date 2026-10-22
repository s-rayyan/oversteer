import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import type { Pt } from './spline';

/** Road point that may carry special-surface flags. */
type FlaggedPt = Pt & { rough?: boolean; pad?: boolean; zone?: boolean };

const BOX = { w: 64, h: 44 };
const PAD = 5;
const FOLLOW_SCALE = 0.1; // world px -> minimap px when following the car

/**
 * Corner minimap. With `full` points (closed circuits) it shows the whole track once;
 * without them (endless) it redraws the road around the car each frame.
 */
export class MiniMap {
  private readonly x = GAME_WIDTH - 4 - BOX.w;
  private readonly y = GAME_HEIGHT - 4 - BOX.h;
  private readonly road: Phaser.GameObjects.Graphics;
  private readonly dot: Phaser.GameObjects.Graphics;
  private fit: { ox: number; oy: number; s: number } | null = null;
  private frame = 0;

  constructor(scene: Phaser.Scene, full: FlaggedPt[] | null) {
    scene.add.rectangle(this.x, this.y, BOX.w, BOX.h, 0x14121f, 0.94).setOrigin(0)
      .setStrokeStyle(1, 0x3d405b).setScrollFactor(0).setDepth(100);
    this.road = scene.add.graphics().setScrollFactor(0).setDepth(101);
    this.dot = scene.add.graphics().setScrollFactor(0).setDepth(102);

    if (full) {
      const xs = full.map((p) => p.x);
      const ys = full.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const w = Math.max(...xs) - minX;
      const h = Math.max(...ys) - minY;
      const s = Math.min((BOX.w - PAD * 2) / w, (BOX.h - PAD * 2) / h);
      this.fit = { s, ox: this.x + (BOX.w - w * s) / 2 - minX * s, oy: this.y + (BOX.h - h * s) / 2 - minY * s };
      const sampled = full.filter((_, i) => i % 6 === 0);
      const pts = sampled.map((p) => this.toBox(p.x, p.y));
      this.stroke([pts.concat(pts[0])]);
      // gravel (brown) and drift zones (blue) drawn over the road line; pads as yellow dots
      for (const [key, color] of [['rough', 0xc9a66b], ['zone', 0x4895ef]] as const) {
        this.road.lineStyle(1, color);
        let run: Pt[] = [];
        sampled.forEach((p, i) => {
          if (p[key]) run.push(pts[i]);
          else { if (run.length > 1) this.road.strokePoints(run, false); run = []; }
        });
        if (run.length > 1) this.road.strokePoints(run, false);
      }
      this.road.fillStyle(0xffd166);
      sampled.forEach((p, i) => { if (p.pad && !sampled[(i - 1 + sampled.length) % sampled.length].pad) this.road.fillRect(pts[i].x - 1, pts[i].y - 1, 2, 2); });
      this.road.fillStyle(0xffffff).fillRect(pts[0].x - 1, pts[0].y - 1, 2, 2); // start line
    }
  }

  private toBox(wx: number, wy: number): Pt {
    const f = this.fit!;
    return { x: Math.round(f.ox + wx * f.s), y: Math.round(f.oy + wy * f.s) };
  }

  private stroke(runs: Pt[][]): void {
    for (const [width, color] of [[3, 0x3d405b], [1, 0xc9d1e3]] as const) {
      this.road.lineStyle(width, color);
      for (const run of runs) {
        if (run.length > 1) this.road.strokePoints(run, false);
      }
    }
  }

  update(carX: number, carY: number, nearby: Pt[], markers: Pt[] = [], now = 0, racers: Array<{ x: number; y: number; color: number }> = []): void {
    this.dot.clear();
    let p: Pt;
    if (this.fit) {
      p = this.toBox(carX, carY);
    } else {
      p = { x: this.x + BOX.w / 2, y: this.y + BOX.h / 2 };
      if (this.frame++ % 3 === 0) {
        this.road.clear();
        const runs: Pt[][] = [];
        let run: Pt[] = [];
        for (const q of nearby) {
          const m = { x: Math.round(p.x + (q.x - carX) * FOLLOW_SCALE), y: Math.round(p.y + (q.y - carY) * FOLLOW_SCALE) };
          const inside = m.x > this.x + 1 && m.x < this.x + BOX.w - 1 && m.y > this.y + 1 && m.y < this.y + BOX.h - 1;
          if (inside) run.push(m);
          else if (run.length) { runs.push(run); run = []; }
        }
        if (run.length) runs.push(run);
        this.stroke(runs);
      }
    }
    // Police: flashing red/blue dots, pinned to the box edge when they're off the map so you still see where they are.
    const flash = Math.floor(now / 160) % 2 ? 0xe63946 : 0x4895ef;
    for (const m of markers) {
      const q = this.fit ? this.toBox(m.x, m.y) : { x: p.x + (m.x - carX) * FOLLOW_SCALE, y: p.y + (m.y - carY) * FOLLOW_SCALE };
      const x = Math.round(Math.min(Math.max(q.x, this.x + 2), this.x + BOX.w - 3));
      const y = Math.round(Math.min(Math.max(q.y, this.y + 2), this.y + BOX.h - 3));
      this.dot.fillStyle(0xffffff).fillRect(x - 2, y - 2, 5, 5).fillStyle(flash).fillRect(x - 1, y - 1, 3, 3);
    }
    if (this.fit) {
      for (const r of racers) {
        const q = this.toBox(r.x, r.y);
        this.dot.fillStyle(0xffffff).fillRect(q.x - 2, q.y - 2, 5, 5).fillStyle(r.color).fillRect(q.x - 1, q.y - 1, 3, 3);
      }
    }
    this.dot.fillStyle(0xffd166).fillRect(p.x - 1, p.y - 1, 3, 3);
  }
}
