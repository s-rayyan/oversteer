import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { formatClock, formatTime, getEndlessBest, submitEndless, type DistanceMode } from '../game/records';
import { STEP, RoadGenerator } from '../game/roadGen';
import { decoKey, paintRoad, paintStartLine, treeDepth, type RoadPt } from '../game/Track';
import { THEMES, type Theme } from '../game/tracks';
import type { Pt } from '../game/spline';
import { getName } from '../game/player';
import { BOARD_ENDLESS, BOARD_OVERSTEER, submitScore } from '../net/leaderboard';
import { firebaseConfigured } from '../net/firebase';
import { DriveScene, type Spawn } from './DriveScene';

const CHUNK = 48; // samples per rendered chunk
const AHEAD = 520; // samples generated ahead of the car
const BEHIND = 260; // samples kept behind the car
const START = 24; // spawn sample
const WINDOW = 40;

interface Chunk {
  kerb: Phaser.GameObjects.Graphics;
  road: Phaser.GameObjects.Graphics;
  trees: Phaser.GameObjects.Image[];
}

/** Procedurally generated road that never ends. The road narrows the further you go. */
export class EndlessScene extends DriveScene {
  protected mode: DistanceMode = 'endless';
  private seed = '';
  private rng!: Phaser.Math.RandomDataGenerator; // decoration only (trees, asphalt grain)
  private theme: Theme = 'grass';
  private pts: RoadPt[] = [];
  private road!: RoadGenerator;
  private chunks = new Map<number, Chunk>();
  private nextChunk = 0;
  private idx = 0;
  private maxIdx = 0;
  private ground!: Phaser.GameObjects.TileSprite;
  private best = 0;

  constructor(key: string = SceneKey.Endless) {
    super(key);
    this.restartLabel = 'New track';
  }

  init(data: { seed?: string }): void {
    this.seed = data.seed ?? Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  protected setupWorld(): Spawn {
    // Separate random streams: the road must depend only on the seed, never on how much scenery was drawn.
    this.rng = new Phaser.Math.RandomDataGenerator([this.seed, 'decor']);
    const roadRng = new Phaser.Math.RandomDataGenerator([this.seed, 'road']);
    this.road = new RoadGenerator(() => roadRng.frac());
    this.theme = new Phaser.Math.RandomDataGenerator([this.seed, 'theme']).pick(THEMES);
    this.pts = [];
    this.chunks = new Map();
    this.nextChunk = 0;
    this.idx = START;
    this.maxIdx = START;
    this.best = getEndlessBest(this.mode);

    this.ground = this.add.tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, `ground-${this.theme}`)
      .setOrigin(0).setScrollFactor(0).setDepth(0);
    this.ensure();
    this.events.once('shutdown', () => this.saveBest());
    return this.pointAt(START);
  }

  private pointAt(i: number): Spawn {
    const p = this.pts[i];
    const q = this.pts[i + 3];
    return { x: p.x, y: p.y, heading: Math.atan2(q.y - p.y, q.x - p.x) };
  }

  protected respawnPoint(): Spawn {
    return this.pointAt(this.idx);
  }

  private ensure(): void {
    while (this.pts.length < this.idx + AHEAD) this.pts.push(this.road.next());
    while ((this.nextChunk + 1) * CHUNK + 1 <= this.pts.length) this.buildChunk(this.nextChunk++);
    for (const [k, c] of this.chunks) {
      if ((k + 1) * CHUNK < this.idx - BEHIND) {
        c.kerb.destroy();
        c.road.destroy();
        c.trees.forEach((t) => t.destroy());
        this.chunks.delete(k);
      }
    }
  }

  private buildChunk(k: number): void {
    const i0 = k * CHUNK;
    const i1 = i0 + CHUNK;
    const kerb = this.add.graphics().setDepth(1);
    const road = this.add.graphics().setDepth(1.1);
    paintRoad(kerb, road, this.rng, this.pts, i0, i1);
    if (i0 <= 10 && i1 >= 12) paintStartLine(road, this.pts[10], this.pts[12], this.pts[10].half * 2);

    const trees: Phaser.GameObjects.Image[] = [];
    const lo = Math.max(0, i0 - 150);
    const hi = Math.min(this.pts.length - 1, i1 + 150);
    for (let i = i0; i < i1; i += 12) {
      const p = this.pts[i];
      const q = this.pts[i + 1];
      const a = Math.atan2(q.y - p.y, q.x - p.x) + (this.rng.frac() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      const off = p.half + 28 + this.rng.frac() * 70;
      const x = p.x + Math.cos(a) * off;
      const y = p.y + Math.sin(a) * off;
      let blocked = false;
      for (let j = lo; j <= hi && !blocked; j += 2) {
        blocked = Math.hypot(this.pts[j].x - x, this.pts[j].y - y) < this.pts[j].half + 24;
      }
      if (!blocked) {
        trees.push(this.add.image(Math.floor(x), Math.floor(y), decoKey(this.theme, this.rng.frac())).setOrigin(0.5, 0.9).setDepth(treeDepth(y)));
      }
    }
    this.chunks.set(k, { kerb, road, trees });
  }

  protected updateMode(): boolean {
    const car = this.car;
    const lo = Math.max(0, this.idx - WINDOW);
    const hi = Math.min(this.pts.length - 1, this.idx + WINDOW);
    let best = this.idx;
    let bd = Infinity;
    for (let j = lo; j <= hi; j++) {
      const dx = this.pts[j].x - car.x;
      const dy = this.pts[j].y - car.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = j; }
    }
    this.idx = best;
    this.maxIdx = Math.max(this.maxIdx, best);
    this.ensure();
    return Math.sqrt(bd) > this.pts[best].half;
  }

  protected afterUpdate(): void {
    const cam = this.cameras.main;
    this.ground.tilePositionX = Math.floor(cam.scrollX);
    this.ground.tilePositionY = Math.floor(cam.scrollY);
  }

  private meters(): number {
    return Math.floor(((this.maxIdx - START) * STEP) / 10);
  }

  private saveBest(): void {
    const m = this.meters();
    if (submitEndless(m, this.mode)) this.best = m;
    // Fire-and-forget; the server keeps only a player's best. Needs a name (asked for in the menu).
    if (firebaseConfigured && m >= 30 && getName()) void submitScore(this.board(), getName(), m).catch(() => {});
  }

  protected hudLines(): string[] {
    return [`${formatClock(this.raceTime)}  ${this.meters()} m`, `BEST ${Math.max(this.best, this.meters())} m`];
  }

  protected mapStatic(): null {
    return null;
  }

  protected mapNearby(): Pt[] {
    return this.pts.slice(Math.max(0, this.idx - 40), this.idx + 140).filter((_, i) => i % 3 === 0);
  }

  protected pauseInfo(): { title: string; lines: string[] } {
    this.saveBest();
    this.settle();
    return {
      title: 'PAUSED',
      lines: [`${this.mode === 'oversteer' ? 'OVERSTEER' : 'Endless'}  #${this.seed}`, `${formatTime(this.raceTime)}   ${this.meters()} m`, `Best ${this.best} m   Coins +${this.coinsPaid}`],
    };
  }

  /** 1 coin per 10 metres (per 5 in OVERSTEER). */
  protected modeCoins(): number {
    return Math.floor(this.meters() / (this.mode === 'oversteer' ? 5 : 10));
  }

  protected board(): string {
    return this.mode === 'oversteer' ? BOARD_OVERSTEER : BOARD_ENDLESS;
  }

  protected restart(): void {
    this.saveBest();
    this.scene.restart({});
  }
}
