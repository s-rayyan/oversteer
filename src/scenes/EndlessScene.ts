import Phaser from 'phaser';
import type { CarStats } from '../game/cars';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { formatClock, formatTime, getEndlessBest, submitEndless, type DistanceMode } from '../game/records';
import { STEP, RoadGenerator } from '../game/roadGen';
import { decoKey, paintRoad, paintStartLine, roadArea, treeDepth, type RoadPt } from '../game/Track';
import { THEMES, type Theme } from '../game/tracks';
import type { Pt } from '../game/spline';
import { BOARD_ENDLESS, BOARD_OVERSTEER, syncLocalBests } from '../net/leaderboard';
import { CATCH_RADIUS, PoliceCar } from '../game/Police';
import { RoadEvents } from '../game/RoadEvents';
import { audio } from '../game/audio';
import type { RunStats } from '../game/challenges';
import { getDailyBest, submitDaily } from '../game/daily';
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
const STAR_EVERY = 35; // seconds of racing per wanted star (1 to 5)
const STAR_SPEED = 0.035; // endless: each star above the first makes cruisers this much faster
const FOURTH_COP_STARS = 4; // from this wanted level a fourth cruiser joins
const SPIN_SECONDS = 2.4; // how long a cruiser spins out when a long drift shakes it
const SPIN_RANGE = 240; // px: a cruiser further than this is not affected
const CLOSE_RADIUS = 22; // px: a cruiser this close (but not touching) is a close call
const CLOSE_COOLDOWN = 3500; // ms before the same cruiser can give another close call
const OIL_SECONDS = 1.3;
/** Side of the reusable road textures: big enough for most chunks in one piece (larger ones take several). */
const TEX = 320;

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
  /**
   * Road textures of chunks that have scrolled away, ready for new ones. Making a new texture means asking the
   * graphics card for memory, which caused a small hitch every time a chunk appeared; reusing one doesn't.
   */
  private texPool: Phaser.GameObjects.RenderTexture[] = [];
  private boostPeak = 0; // OVERSTEER: highest speed reached while boosting this run (px/s)
  private roadEvents!: RoadEvents; // oil, cones, roadblocks and gates
  private daily = false; // the daily road: same seed for everyone today, best kept on this device only
  private starsShown = 1;
  private bestAtStart = 0;
  private bestAnnounced = false;
  private closeAt = new Map<PoliceCar, number>();

  constructor(key: string = SceneKey.Endless) {
    super(key);
    this.restartLabel = 'New track';
  }

  init(data: { seed?: string; daily?: boolean }): void {
    this.daily = !!data.daily;
    this.seed = data.seed ?? Math.random().toString(36).slice(2, 7).toUpperCase();
    this.restartLabel = this.daily ? 'Retry daily road' : 'New track';
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
    this.best = this.daily ? getDailyBest(this.mode) : getEndlessBest(this.mode);
    this.bestAtStart = this.best;
    this.bestAnnounced = false;
    this.starsShown = 1;
    this.closeAt = new Map();
    this.roadEvents = new RoadEvents(this, this.seed, CHUNK);
    this.cops = [];
    this.texPool = []; // the old ones went with the previous run's scene
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
        c.layers.forEach((l) => this.texPool.push(l.setVisible(false)));
        c.trees.forEach((t) => t.destroy());
        this.roadEvents.drop(k);
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
    const layers = [...this.bake(kerb, area, 1), ...this.bake(road, area, 1.1)];

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
    this.roadEvents.build(k, this.pts, i0, i1);
  }

  /** Paints a Graphics object into pooled textures covering `area`, then removes it (see bakeGraphics in Track.ts). */
  private bake(gfx: Phaser.GameObjects.Graphics, area: Phaser.Geom.Rectangle, depth: number): Phaser.GameObjects.RenderTexture[] {
    const out: Phaser.GameObjects.RenderTexture[] = [];
    const x0 = Math.floor(area.x);
    const y0 = Math.floor(area.y);
    for (let y = y0; y < area.bottom; y += TEX) {
      for (let x = x0; x < area.right; x += TEX) {
        const rt = (this.texPool.pop() ?? this.add.renderTexture(0, 0, TEX, TEX).setOrigin(0))
          .setPosition(x, y).setDepth(depth).setVisible(true).clear();
        rt.draw(gfx, -x, -y);
        out.push(rt);
      }
    }
    gfx.destroy();
    return out;
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
    if (this.state === 'racing') {
      this.roadEvents.update(this.idx, this.car, this.car.phys.drifting, {
        oil: () => this.makeSlick(OIL_SECONDS),
        cone: (x, y) => { this.impact(x, y, 0.92, false); this.stat('cones'); },
        barrier: (x, y) => this.impact(x, y, 0.4, true),
        gate: (drifting) => {
          this.stat('gates');
          audio.sfx('gate');
          if (drifting) {
            this.stat('driftGates');
            this.bonus(12, 'DRIFT GATE', '#52b788');
          } else {
            this.bonus(2, 'GATE', '#8d99ae');
          }
        },
      });
      this.announceBest();
    }
    this.updatePolice(dt);
  }

  /** Wanted level: one more star every STAR_EVERY seconds, up to five. */
  private stars(): number {
    return Math.min(5, 1 + Math.floor(this.raceTime / STAR_EVERY));
  }

  /** The moment you pass your previous best: a banner and confetti (not on a first-ever run). */
  private announceBest(): void {
    if (this.bestAnnounced || this.bestAtStart <= 0 || this.meters() <= this.bestAtStart) return;
    this.bestAnnounced = true;
    this.showFlash('NEW BEST!', 2000, '#52b788');
    audio.sfx('best');
    this.confetti(60);
  }

  /** Cruisers join the chase over time; if one reaches the car the run ends. */
  private updatePolice(dt: number): void {
    if (this.state !== 'racing') return;
    if (this.wasBoosting) this.boostPeak = Math.max(this.boostPeak, this.car.speed);
    const stars = this.stars();
    if (stars > this.starsShown) {
      this.starsShown = stars;
      this.showFlash(`WANTED LEVEL ${stars}!`, 2000, '#e63946');
      audio.sfx('wanted');
    }
    const due = this.raceTime >= POLICE_FIRST + this.cops.length * POLICE_EVERY;
    const maxCops = POLICE_MAX + (stars >= FOURTH_COP_STARS ? 1 : 0);
    if (due && this.cops.length < maxCops) {
      this.cops.push(new PoliceCar(this, this.pts, Math.max(0, this.idx - POLICE_SPAWN_BEHIND)));
      this.showFlash('POLICE BEHIND YOU!', 2000, '#e63946');
      audio.sfx('wanted');
    }
    for (const cop of this.cops) {
      // Rubber band: the further back a cruiser is, the faster it drives; it eases off as it closes in.
      const gap = cop.distanceTo(this.car.x, this.car.y);
      const t = Phaser.Math.Clamp((gap - POLICE_NEAR_GAP) / (POLICE_FAR_GAP - POLICE_NEAR_GAP), 0, 1);
      // In OVERSTEER the band only ever slows a cruiser: its top speed is a hard 90% of your boosted speed.
      const band = Phaser.Math.Linear(POLICE_NEAR, this.mode === 'oversteer' ? 1 : POLICE_FAR, t);
      cop.update(dt, this.time.now, this.pts, this.idx, this.car, this.policeTop() * band);
      if (cop.spinning) continue; // a spinning cruiser can't catch you
      if (gap < CATCH_RADIUS) return this.bust(cop);
      if (gap < CLOSE_RADIUS && this.time.now - (this.closeAt.get(cop) ?? -Infinity) > CLOSE_COOLDOWN) {
        this.closeAt.set(cop, this.time.now);
        this.stat('closeCalls');
        this.bonus(5, 'CLOSE CALL');
        audio.sfx('close');
      }
    }
  }

  protected tuneStats(stats: CarStats): CarStats {
    return { ...stats, maxSpeed: stats.maxSpeed * ENDLESS_SPEED, accel: stats.accel * ENDLESS_SPEED };
  }

  private policeTop(): number {
    const st = this.car.stats;
    // A boost rarely reaches the stat-sheet cap (the tank runs out first), so OVERSTEER measures the car's real boosted speed.
    if (this.mode === 'oversteer') return Math.max(this.boostPeak, st.maxSpeed) * POLICE_SPEED_OVERSTEER;
    // In endless every wanted star makes the cruisers a little faster.
    return st.maxSpeed * POLICE_SPEED * (1 + STAR_SPEED * (this.stars() - 1));
  }

  /** A long drift shakes the nearest cruiser: it spins out for a moment, and you get a small bonus. */
  protected chainReached(): void {
    let near: PoliceCar | null = null;
    let nd = SPIN_RANGE;
    for (const cop of this.cops) {
      const d = cop.distanceTo(this.car.x, this.car.y);
      if (d < nd && !cop.spinning) { near = cop; nd = d; }
    }
    if (!near || !near.spinOut(SPIN_SECONDS)) return;
    this.stat('copsShaken');
    this.bonus(8, 'COP SPUN OUT!', '#4895ef');
    audio.sfx('spin');
    this.rumble(0.3, 0.7, 250);
  }

  protected sirenLevel(): number {
    let nearest = Infinity;
    for (const cop of this.cops) nearest = Math.min(nearest, cop.distanceTo(this.car.x, this.car.y));
    return Phaser.Math.Clamp(1 - (nearest - 40) / 360, 0, 1);
  }

  protected modeStats(): Partial<RunStats> {
    return { mode: this.mode, daily: this.daily, meters: this.meters(), stars: this.stars() };
  }

  private bust(cop: PoliceCar): void {
    const m = this.meters();
    this.shake(400, 0.012);
    audio.sfx('bust');
    this.rumble(1, 1, 500);
    this.slowMo(900);
    cop.spinOut(1.5);
    this.saveBest(); // the run still counts
    this.settle();
    this.finish('BUSTED!', ['The police caught you.', `Run ended at ${m} m`, `Best ${this.best} m   Coins +${this.coinsPaid}`], 1100);
  }

  private meters(): number {
    return Math.floor(((this.maxIdx - START) * STEP) / 10);
  }

  protected autosave(): void {
    super.autosave();
    if (this.state === 'racing') {
      const m = this.meters();
      if (this.recordBest(m)) this.best = m; // local only: the online post happens on pause/bust/exit
    }
  }

  /** Stores a distance as a best: today's daily best on the daily road, otherwise the (online) endless best. */
  private recordBest(m: number): boolean {
    return this.daily ? submitDaily(m, this.mode) : submitEndless(m, this.mode);
  }

  private saveBest(): void {
    const m = this.meters();
    if (this.recordBest(m)) this.best = m;
    // A new best is queued by submitEndless; this posts it (fire-and-forget, needs a name). Pausing or quitting
    // without beating your best posts nothing, so it costs no database reads. The daily road never goes online.
    if (!this.daily) void syncLocalBests();
  }

  protected hudLines(): string[] {
    const lines = [`${formatClock(this.raceTime)}  ${this.meters()} m`, `${this.daily ? 'TODAY' : 'BEST'} ${Math.max(this.best, this.meters())} m`];
    if (this.cops.length) {
      const stars = this.stars();
      lines.push(`POLICE x${this.cops.length}  WANTED ${'*'.repeat(stars)}${'-'.repeat(5 - stars)}`);
    }
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
      lines: [`${this.mode === 'oversteer' ? 'OVERSTEER' : 'Endless'}  ${this.daily ? 'DAILY ROAD' : '#' + this.seed}`, `${formatTime(this.raceTime)}   ${this.meters()} m`, `Best ${this.best} m   Coins +${this.coinsPaid}`],
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
    this.scene.restart(this.daily ? { seed: this.seed, daily: true } : {});
  }
}
