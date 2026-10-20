import Phaser from 'phaser';
import type { CarStats } from '../game/cars';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { formatClock, formatTime, getEndlessBest, submitEndless, type DistanceMode } from '../game/records';
import { STEP, RoadGenerator } from '../game/roadGen';
import { bakeGraphics, decoKey, paintRoad, paintStartLine, roadArea, treeDepth, type RoadPt } from '../game/Track';
import { THEMES, type Theme } from '../game/tracks';
import type { Pt } from '../game/spline';
import { getName } from '../game/player';
import { BOARD_ENDLESS, BOARD_OVERSTEER, submitScore } from '../net/leaderboard';
import { firebaseConfigured } from '../net/firebase';
import { CATCH_RADIUS, PoliceCar } from '../game/Police';
import { DriveScene, MIN_ZOOM, type Spawn } from './DriveScene';

const CHUNK = 48; // samples per rendered chunk
const AHEAD = 520; // samples generated ahead of the car
const BEHIND = 260; // samples kept behind the car
const START = 24; // spawn sample
const WINDOW = 40;
const POLICE_FIRST = 12; // seconds of racing before the first cruiser appears
const POLICE_EVERY = 20; // seconds between further cruisers
const POLICE_MAX = 3;
const POLICE_SPEED = 0.97; // endless: fraction of the player's top speed (boosting outruns them)
const POLICE_SPEED_OVERSTEER = 0.9; // OVERSTEER: fraction of the fastest speed you've actually reached while boosting, never exceeded: while you boost you pull away, and they catch you only once the boost runs dry
const ENDLESS_SPEED = 1.2; // the endless road is run with a faster car (top speed and acceleration); the cruisers scale with it
const POLICE_NEAR = 0.8; // speed multiplier when a cruiser is right on you (eases off so it isn't unfair)...
const POLICE_FAR = 1.4; // ...rising to this when it's far behind, so it always closes the gap again
const POLICE_NEAR_GAP = 80; // px at or below which the NEAR multiplier applies
const POLICE_FAR_GAP = 480; // px at or above which the FAR multiplier applies
const POLICE_SPAWN_BEHIND = 90; // road samples behind the car

interface Chunk {
  /** The painted road for this stretch, baked into textures (kerbs and asphalt are separate layers). */
  layers: Phaser.GameObjects.RenderTexture[];
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
  private groundW = GAME_WIDTH;
  private groundH = GAME_HEIGHT;
  private best = 0;
  private cops: PoliceCar[] = [];
  private boostPeak = 0; // OVERSTEER: highest speed reached while boosting this run (px/s)

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
    this.cops = [];
    this.boostPeak = 0;

    // Oversized so it still covers the screen when the speed zoom pulls the camera out.
    this.groundW = Math.ceil(GAME_WIDTH / MIN_ZOOM) + 4;
    this.groundH = Math.ceil(GAME_HEIGHT / MIN_ZOOM) + 4;
    this.ground = this.add.tileSprite((GAME_WIDTH - this.groundW) / 2, (GAME_HEIGHT - this.groundH) / 2, this.groundW, this.groundH, `ground-${this.theme}`)
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
        c.layers.forEach((l) => l.destroy());
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
    // Paint once, then keep only textures: a Graphics object would replay all its commands on every frame.
    const area = roadArea(this.pts, i0, i1);
    const layers = [...bakeGraphics(this, kerb, area, 1), ...bakeGraphics(this, road, area, 1.1)];

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
    this.chunks.set(k, { layers, trees });
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

  protected afterUpdate(dt: number): void {
    const cam = this.cameras.main;
    this.ground.tilePositionX = Math.floor(cam.scrollX - (this.groundW - GAME_WIDTH) / 2);
    this.ground.tilePositionY = Math.floor(cam.scrollY - (this.groundH - GAME_HEIGHT) / 2);
    this.updatePolice(dt);
  }

  /** Cruisers join the chase over time; if one reaches the car the run ends. */
  private updatePolice(dt: number): void {
    if (this.state !== 'racing') return;
    if (this.wasBoosting) this.boostPeak = Math.max(this.boostPeak, this.car.speed);
    const due = this.raceTime >= POLICE_FIRST + this.cops.length * POLICE_EVERY;
    if (due && this.cops.length < POLICE_MAX) {
      this.cops.push(new PoliceCar(this, this.pts, Math.max(0, this.idx - POLICE_SPAWN_BEHIND)));
      this.showFlash('POLICE BEHIND YOU!', 2000);
    }
    for (const cop of this.cops) {
      // Rubber band: the further back a cruiser is, the faster it drives; it eases off as it closes in.
      const gap = cop.distanceTo(this.car.x, this.car.y);
      const t = Phaser.Math.Clamp((gap - POLICE_NEAR_GAP) / (POLICE_FAR_GAP - POLICE_NEAR_GAP), 0, 1);
      // In OVERSTEER the band only ever slows a cruiser: its top speed is a hard 90% of your boosted speed.
      const band = Phaser.Math.Linear(POLICE_NEAR, this.mode === 'oversteer' ? 1 : POLICE_FAR, t);
      cop.update(dt, this.time.now, this.pts, this.idx, this.car, this.policeTop() * band);
      if (gap < CATCH_RADIUS) return this.bust();
    }
  }

  protected tuneStats(stats: CarStats): CarStats {
    return { ...stats, maxSpeed: stats.maxSpeed * ENDLESS_SPEED, accel: stats.accel * ENDLESS_SPEED };
  }

  private policeTop(): number {
    const st = this.car.stats;
    // A boost rarely reaches the stat-sheet cap (the tank runs out first), so OVERSTEER measures the car's real boosted speed.
    return this.mode === 'oversteer' ? Math.max(this.boostPeak, st.maxSpeed) * POLICE_SPEED_OVERSTEER : st.maxSpeed * POLICE_SPEED;
  }

  private bust(): void {
    const m = this.meters();
    this.shake(400, 0.012);
    this.saveBest(); // the run still counts
    this.settle();
    this.finish('BUSTED!', ['The police caught you.', `Run ended at ${m} m`, `Best ${this.best} m   Coins +${this.coinsPaid}`]);
  }

  private meters(): number {
    return Math.floor(((this.maxIdx - START) * STEP) / 10);
  }

  protected autosave(): void {
    super.autosave();
    if (this.state === 'racing') {
      const m = this.meters();
      if (submitEndless(m, this.mode)) this.best = m; // local only: the online post happens on pause/bust/exit
    }
  }

  private saveBest(): void {
    const m = this.meters();
    if (submitEndless(m, this.mode)) this.best = m;
    // Fire-and-forget; the server keeps only a player's best. Needs a name (asked for in the menu).
    if (firebaseConfigured && m >= 30 && getName()) void submitScore(this.board(), getName(), m).catch(() => {});
  }

  protected hudLines(): string[] {
    const lines = [`${formatClock(this.raceTime)}  ${this.meters()} m`, `BEST ${Math.max(this.best, this.meters())} m`];
    if (this.cops.length) lines.push(`POLICE x${this.cops.length}`);
    return lines;
  }

  protected mapStatic(): null {
    return null;
  }

  protected mapMarkers(): Pt[] {
    return this.cops.map((c) => ({ x: c.x, y: c.y }));
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
