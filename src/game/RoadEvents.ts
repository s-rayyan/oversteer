import Phaser from 'phaser';
import { treeDepth, type RoadPt } from './Track';

/**
 * Things that happen on the endless road: oil slicks (lose your grip), traffic cones (small speed loss),
 * roadblocks with a gap in them (big speed loss) and drift gates (pay coins, more if you drift through them).
 *
 * Objects are placed per road chunk from a random stream of their own, so the road itself never depends on them.
 */

const OIL_R = 9;
const CONE_R = 3;
const BARRIER_R = 7;
const CAR_R = 4;
const BARRIER_STEP = 12;
const GAP = 38; // width of the opening in a roadblock (cars are ~16 long, ~9 wide)
const FIRST_CHUNK = 2;
const MIN_BLOCK_CHUNK = 8; // roadblocks only start further down the road

type Kind = 'oil' | 'cone' | 'barrier' | 'gate';

interface RoadObj {
  kind: Kind;
  x: number;
  y: number;
  r: number;
  live: boolean;
  touching: boolean;
  sprite?: Phaser.GameObjects.Image;
  // gates only
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  half: number;
  lastS: number | null;
  bar?: Phaser.GameObjects.Rectangle;
  posts?: Phaser.GameObjects.Image[];
}

export interface RoadEventHooks {
  /** The car rolled into an oil slick. */
  oil(): void;
  /** The car hit a cone / a roadblock barrier at this spot. */
  cone(x: number, y: number): void;
  barrier(x: number, y: number): void;
  /** The car crossed a gate; `drifting` says whether it was sliding at the time. */
  gate(drifting: boolean): void;
}

export class RoadEvents {
  private chunks = new Map<number, RoadObj[]>();
  private lastChunk = -10;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly seed: string,
    private readonly chunkSize: number,
  ) {}

  /** Places this chunk's events (if any) along samples [i0, i1). */
  build(k: number, pts: RoadPt[], i0: number, i1: number): void {
    if (k < FIRST_CHUNK || k - this.lastChunk < 2) return;
    const rng = new Phaser.Math.RandomDataGenerator([this.seed, 'events', String(k)]);
    const chance = 0.12 + 0.22 * Math.min(1, k / 70);
    if (rng.frac() > chance) return;

    const roll = rng.frac();
    let kind: 'oil' | 'cones' | 'block' | 'gate' = roll < 0.3 ? 'oil' : roll < 0.58 ? 'cones' : roll < 0.8 ? 'block' : 'gate';
    if (kind === 'block' && k < MIN_BLOCK_CHUNK) kind = 'cones';
    this.lastChunk = k;

    const j = i0 + 6 + Math.floor(rng.frac() * (i1 - i0 - 14));
    const p = pts[j];
    const q = pts[j + 1];
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const tx = (q.x - p.x) / len;
    const ty = (q.y - p.y) / len;
    const nx = -ty;
    const ny = tx;
    const at = (lat: number, along = 0) => ({ x: p.x + nx * lat + tx * along, y: p.y + ny * lat + ty * along });
    const list: RoadObj[] = [];
    const base = { live: true, touching: false, tx, ty, nx, ny, half: p.half, lastS: null };
    const heading = Math.atan2(ty, tx);

    if (kind === 'oil') {
      const count = rng.frac() < 0.2 ? 2 : 1;
      for (let m = 0; m < count; m++) {
        const lat = (rng.frac() - 0.5) * p.half * 1.2;
        const pos = at(lat, m * 14);
        const scale = 1 + rng.frac() * 0.3;
        const sprite = this.scene.add.image(Math.floor(pos.x), Math.floor(pos.y), 'oil').setDepth(1.2).setRotation(heading + (rng.frac() - 0.5)).setScale(scale);
        list.push({ ...base, kind: 'oil', x: pos.x, y: pos.y, r: OIL_R * scale, sprite });
      }
    } else if (kind === 'cones') {
      const n = 3 + Math.floor(rng.frac() * 3);
      const lat0 = (rng.frac() - 0.5) * p.half * 1.4;
      for (let m = 0; m < n; m++) {
        const lat = lat0 + m * 8;
        if (Math.abs(lat) > p.half - 4) continue;
        const pos = at(lat);
        const sprite = this.scene.add.image(Math.floor(pos.x), Math.floor(pos.y), 'cone').setDepth(8);
        list.push({ ...base, kind: 'cone', x: pos.x, y: pos.y, r: CONE_R, sprite });
      }
    } else if (kind === 'block') {
      const gap = Math.min(GAP, p.half * 2 - 12);
      const gc = (rng.frac() - 0.5) * Math.max(0, p.half * 2 - gap - 8);
      const place = (from: number, to: number) => {
        for (let lat = from + BARRIER_STEP / 2; lat < to; lat += BARRIER_STEP) {
          const pos = at(lat);
          const sprite = this.scene.add.image(Math.floor(pos.x), Math.floor(pos.y), 'barrier').setDepth(8).setRotation(Math.atan2(ny, nx));
          list.push({ ...base, kind: 'barrier', x: pos.x, y: pos.y, r: BARRIER_R, sprite });
        }
      };
      place(-p.half, gc - gap / 2);
      place(gc + gap / 2, p.half);
    } else {
      const bar = this.scene.add.rectangle(p.x, p.y, p.half * 2, 3, 0xffd166, 0.75).setDepth(1.4).setRotation(Math.atan2(ny, nx));
      const posts = [-1, 1].map((side) => {
        const pos = at(side * (p.half + 3));
        return this.scene.add.image(Math.floor(pos.x), Math.floor(pos.y), 'post').setOrigin(0.5, 0.8).setDepth(treeDepth(pos.y));
      });
      list.push({ ...base, kind: 'gate', x: p.x, y: p.y, r: 0, bar, posts });
    }
    if (list.length) this.chunks.set(k, list);
  }

  /** Removes a chunk's objects (the road scrolled past it). */
  drop(k: number): void {
    const list = this.chunks.get(k);
    if (!list) return;
    for (const o of list) {
      o.sprite?.destroy();
      o.bar?.destroy();
      o.posts?.forEach((s) => s.destroy());
    }
    this.chunks.delete(k);
  }

  /** Checks the car against the objects around it. `idx` is the car's nearest road sample. */
  update(idx: number, car: { x: number; y: number }, drifting: boolean, hooks: RoadEventHooks): void {
    const kc = Math.floor(idx / this.chunkSize);
    for (let k = kc - 1; k <= kc + 2; k++) {
      const list = this.chunks.get(k);
      if (!list) continue;
      for (const o of list) {
        if (!o.live) continue;
        if (o.kind === 'gate') {
          this.checkGate(o, car, drifting, hooks);
          continue;
        }
        const d = Math.hypot(car.x - o.x, car.y - o.y);
        const hit = d < o.r + CAR_R;
        if (o.kind === 'oil') {
          if (hit && !o.touching) hooks.oil();
          o.touching = hit;
        } else if (hit) {
          o.live = false;
          this.knock(o, car);
          if (o.kind === 'cone') hooks.cone(o.x, o.y);
          else hooks.barrier(o.x, o.y);
        }
      }
    }
  }

  private checkGate(o: RoadObj, car: { x: number; y: number }, drifting: boolean, hooks: RoadEventHooks): void {
    const dx = car.x - o.x;
    const dy = car.y - o.y;
    const s = dx * o.tx + dy * o.ty;
    const lat = dx * o.nx + dy * o.ny;
    const crossed = o.lastS !== null && o.lastS < 0 && s >= 0 && Math.abs(lat) <= o.half;
    o.lastS = s;
    if (!crossed) return;
    o.live = false;
    o.bar?.setFillStyle(drifting ? 0x52b788 : 0x8d99ae, 0.7);
    hooks.gate(drifting);
  }

  /** A smashed cone or barrier flies off the road and fades. */
  private knock(o: RoadObj, car: { x: number; y: number }): void {
    const sprite = o.sprite;
    if (!sprite) return;
    const a = Math.atan2(o.y - car.y, o.x - car.x);
    const dist = o.kind === 'cone' ? 26 : 16;
    this.scene.tweens.add({
      targets: sprite,
      x: sprite.x + Math.cos(a) * dist,
      y: sprite.y + Math.sin(a) * dist,
      rotation: sprite.rotation + 5,
      alpha: 0,
      duration: 420,
      onComplete: () => sprite.destroy(),
    });
  }

  destroy(): void {
    for (const k of [...this.chunks.keys()]) this.drop(k);
  }
}

