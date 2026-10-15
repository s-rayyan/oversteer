import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';
import type { Pt } from './spline';

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

  constructor(scene: Phaser.Scene, full: Pt[] | null) {
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
      const pts = full.filter((_, i) => i % 6 === 0).map((p) => this.toBox(p.x, p.y));
      this.stroke([pts.concat(pts[0])]);
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

  update(carX: number, carY: number, nearby: Pt[]): void {
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
    this.dot.fillStyle(0xffd166).fillRect(p.x - 1, p.y - 1, 3, 3);
  }
}
