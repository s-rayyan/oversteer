import Phaser from 'phaser';
import { RACE_PAY } from '../game/cars';
import { GAME_WIDTH, SceneKey } from '../game/config';
import { GHOST_DT, GHOST_STRIDE, loadGhost, q1, saveGhostIfBest, type GhostData } from '../game/ghost';
import { selectedCar } from '../game/profile';
import { surfaceFlags, type SurfaceFlags } from '../game/surfaces';
import { formatClock, formatTime, getRecord, submitRace } from '../game/records';
import type { Pt } from '../game/spline';
import { buildTrack, type RoadPt } from '../game/Track';
import { TRACKS, type TrackDef } from '../game/tracks';
import { DriveScene, type Spawn } from './DriveScene';

const WINDOW = 40; // samples searched either side of the last known position

/** Circuit race: N laps, lap timing, personal bests. */
export class RaceScene extends DriveScene {
  private track!: TrackDef;
  private samples: RoadPt[] = [];
  private flags: SurfaceFlags[] = [];
  private idx = 0;
  private total = 0; // signed samples travelled relative to the start line
  private maxTotal = 0;
  private lapStart = 0;
  private lapTimes: number[] = [];
  private bestLap = Infinity;
  private finishPayout = 0;

  // Ghost: replay of your best run, plus a recording of this one.
  private ghost: GhostData | null = null;
  private ghostSprite: Phaser.GameObjects.Image | null = null;
  private ghostOn = true;
  private ghostIdx = 0;
  private rec: number[] = [];
  private nextRec = 0;
  private deltaText!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.Race);
  }

  init(data: { trackId?: string }): void {
    this.track = TRACKS.find((t) => t.id === data.trackId) ?? TRACKS[0];
  }

  protected setupWorld(): Spawn {
    const built = buildTrack(this, this.track);
    this.samples = built.samples;
    this.flags = surfaceFlags(this.samples.length, this.track);
    const b = built.bounds;
    this.cameras.main.setBounds(b.x, b.y, b.width, b.height);

    const n = this.samples.length;
    const grid = 14; // start a little behind the line
    this.idx = n - grid;
    this.total = -grid;
    this.maxTotal = -grid;
    this.lapStart = 0;
    this.lapTimes = [];
    this.finishPayout = 0;
    this.bestLap = getRecord(this.track.id).bestLap ?? Infinity;

    this.rec = [];
    this.nextRec = 0;
    this.ghostIdx = 0;
    this.ghostOn = true;
    this.ghost = loadGhost(this.track.id);
    this.ghostSprite = this.ghost
      ? this.add.image(0, 0, `car-${this.ghost.carId}`).setAlpha(0.5).setTint(0xbfe9ff).setDepth(9.5)
      : null;
    this.deltaText = this.add.text(GAME_WIDTH / 2, 15, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#ffffff', stroke: '#14121f', strokeThickness: 2,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
    this.input.keyboard!.on('keydown-G', () => {
      if (!this.ghost) return;
      this.ghostOn = !this.ghostOn;
      this.showFlash(this.ghostOn ? 'GHOST ON' : 'GHOST OFF', 700);
    });
    return this.pointAt(this.idx);
  }

  private pointAt(i: number): Spawn {
    const n = this.samples.length;
    const p = this.samples[i];
    const q = this.samples[(i + 3) % n];
    return { x: p.x, y: p.y, heading: Math.atan2(q.y - p.y, q.x - p.x) };
  }

  protected respawnPoint(): Spawn {
    return this.pointAt(this.idx);
  }

  protected updateMode(): boolean {
    const n = this.samples.length;
    const car = this.car;
    let best = this.idx;
    let bd = Infinity;
    for (let d = -WINDOW; d <= WINDOW; d++) {
      const j = (this.idx + d + n) % n;
      const dx = this.samples[j].x - car.x;
      const dy = this.samples[j].y - car.y;
      const dist = dx * dx + dy * dy;
      if (dist < bd) { bd = dist; best = j; }
    }
    let delta = best - this.idx;
    if (delta < -n / 2) delta += n;
    else if (delta > n / 2) delta -= n;
    this.idx = best;
    this.total += delta;

    if (this.total > this.maxTotal) {
      const before = Math.floor(this.maxTotal / n);
      const after = Math.floor(this.total / n);
      this.maxTotal = this.total;
      if (after > before && this.state === 'racing') this.crossLine(after);
    }
    this.surface = this.flags[best];
    return Math.sqrt(bd) > this.samples[best].half;
  }

  protected afterUpdate(): void {
    if (this.state === 'racing') {
      while (this.nextRec <= this.raceTime) {
        this.rec.push(q1(this.car.x), q1(this.car.y), Math.round(this.car.facing * 1000) / 1000, this.total);
        this.nextRec += GHOST_DT;
      }
    }
    this.updateGhost();
  }

  private updateGhost(): void {
    const g = this.ghost;
    const sprite = this.ghostSprite;
    if (!g || !sprite) return;
    const n = g.frames.length / GHOST_STRIDE;
    const f = Math.max(0, this.raceTime) / GHOST_DT;
    const i = Math.min(Math.floor(f), n - 1);
    const j = Math.min(i + 1, n - 1);
    const k = Math.min(f - i, 1);
    const a = i * GHOST_STRIDE;
    const b = j * GHOST_STRIDE;
    const fr = g.frames;
    sprite.setPosition(fr[a] + (fr[b] - fr[a]) * k, fr[a + 1] + (fr[b + 1] - fr[a + 1]) * k);
    sprite.setRotation(fr[a + 2] + Phaser.Math.Angle.Wrap(fr[b + 2] - fr[a + 2]) * k);
    sprite.setVisible(this.ghostOn && f < n + 20); // lingers a second at the finish, then vanishes

    // Time delta: how long the ghost took to reach the point you're at now.
    if (this.state !== 'racing' || !this.ghostOn) {
      this.deltaText.setText('');
      return;
    }
    while (this.ghostIdx < n - 1 && fr[this.ghostIdx * GHOST_STRIDE + 3] < this.maxTotal) this.ghostIdx++;
    const hi = this.ghostIdx;
    if (hi === 0 || fr[hi * GHOST_STRIDE + 3] < this.maxTotal) {
      this.deltaText.setText('');
      return;
    }
    const p0 = fr[(hi - 1) * GHOST_STRIDE + 3];
    const p1 = fr[hi * GHOST_STRIDE + 3];
    const ghostTime = (hi - 1 + (p1 === p0 ? 0 : (this.maxTotal - p0) / (p1 - p0))) * GHOST_DT;
    const d = this.raceTime - ghostTime;
    this.deltaText.setText(`${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(2)}`).setColor(d > 0 ? '#e63946' : '#52b788');
  }

  /** Called when the car crosses the line for the k-th time (k=0: start of lap 1). */
  private crossLine(k: number): void {
    if (k === 0) {
      this.lapStart = this.raceTime;
      return;
    }
    const lapTime = this.raceTime - this.lapStart;
    this.lapStart = this.raceTime;
    this.lapTimes.push(lapTime);
    const isBest = lapTime < this.bestLap;
    if (isBest) this.bestLap = lapTime;

    if (k >= this.track.laps) {
      this.finishRace();
    } else {
      this.showFlash(`LAP ${k}  ${formatTime(lapTime)}${isBest ? '  BEST!' : ''}`);
    }
  }

  private finishRace(): void {
    const bestThisRun = Math.min(...this.lapTimes);
    const r = submitRace(this.track.id, this.raceTime, bestThisRun);
    const lines = this.lapTimes.map((t, i) => `Lap ${i + 1}   ${formatTime(t)}`);
    lines.push(`Total   ${formatTime(this.raceTime)}${r.newBest ? '  NEW RECORD!' : ''}`);
    lines.push(`Best lap ${formatTime(bestThisRun)}${r.newLap ? '  NEW RECORD!' : ''}`);
    const base = RACE_PAY[this.track.difficulty];
    this.finishPayout = base + (r.newBest ? Math.floor(base / 2) : 0);
    const owed = this.settle();
    lines.push(`Coins +${owed}  (finish ${this.finishPayout}, drift ${Math.floor(this.driftBank)})`);
    if (saveGhostIfBest(this.track.id, { time: this.raceTime, carId: selectedCar().id, frames: this.rec })) {
      lines.push('Ghost saved');
    }
    this.finish('FINISHED', lines);
    void this.submitOnline(Math.round(this.raceTime * 1000));
  }

  private lapNumber(): number {
    return Phaser.Math.Clamp(Math.floor(this.maxTotal / this.samples.length) + 1, 1, this.track.laps);
  }

  protected hudLines(): string[] {
    const lines = [`LAP ${this.lapNumber()}/${this.track.laps}  ${formatClock(this.raceTime)}`];
    if (this.bestLap < Infinity) lines.push(`BEST ${formatClock(this.bestLap)}`);
    return lines;
  }

  protected mapStatic(): Pt[] {
    return this.samples;
  }

  protected pauseInfo(): { title: string; lines: string[] } {
    return {
      title: 'PAUSED',
      lines: [
        this.track.name,
        `Lap ${this.lapNumber()}/${this.track.laps}   ${formatTime(this.raceTime)}`,
        ...(this.ghost ? [`G ghost ${this.ghostOn ? 'on' : 'off'}  (best ${formatTime(this.ghost.time)})`] : []),
      ],
    };
  }

  protected modeCoins(): number {
    return this.finishPayout;
  }

  protected board(): string {
    return this.track.id;
  }

  protected restart(): void {
    this.scene.restart({ trackId: this.track.id });
  }
}
