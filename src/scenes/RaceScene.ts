import Phaser from 'phaser';
import { RACE_PAY } from '../game/cars';
import { GAME_WIDTH, SceneKey } from '../game/config';
import { GHOST_DT, getGhostMode, loadGhost, q1, saveGhostIfBest, type GhostMode } from '../game/ghost';
import { GhostRunner } from '../game/GhostRunner';
import { getName } from '../game/player';
import { fetchTopGhost, syncGhost, uploadGhost, type OnlineGhost } from '../net/ghosts';
import { firebaseConfigured } from '../net/firebase';
import { selectedCar } from '../game/profile';
import { surfaceFlags, type SurfaceFlags } from '../game/surfaces';
import { formatClock, formatTime, getRecord, submitRace } from '../game/records';
import type { Pt } from '../game/spline';
import { buildTrack, type RoadPt } from '../game/Track';
import { TRACKS, type TrackDef } from '../game/tracks';
import { DriveScene, type Spawn } from './DriveScene';

const WINDOW = 40; // samples searched either side of the last known position

const MINE_TINT = 0xbfe9ff;
const TOP_TINT = 0xffd166;
const shortName = (n: string) => n.slice(0, 8).toUpperCase();

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

  // Ghosts: your best run, and the fastest uploaded run; plus a recording of this one.
  private mine: GhostRunner | null = null;
  private top: GhostRunner | null = null;
  private topInfo: OnlineGhost | null = null;
  private topStatus: 'loading' | 'ready' | 'none' | 'offline' = 'loading';
  private ghostMode: GhostMode = 'mine';
  private runToken = 0; // lets a late network reply tell it belongs to a scene that has since restarted
  private rec: number[] = [];
  private nextRec = 0;
  private deltaMine!: Phaser.GameObjects.Text;
  private deltaTop!: Phaser.GameObjects.Text;

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
    const board = this.track.id;
    const token = ++this.runToken;
    const local = loadGhost(board);
    this.mine = local ? new GhostRunner(this, local, MINE_TINT) : null;
    this.top = null;
    this.topInfo = null;
    this.ghostMode = getGhostMode();
    this.topStatus = firebaseConfigured ? 'loading' : 'offline';
    if (firebaseConfigured) {
      void fetchTopGhost(board).then((t) => {
        if (token !== this.runToken || !this.scene.isActive()) return;
        if (!t) { this.topStatus = 'none'; if (this.ghostMode === 'top') this.showFlash('NO ONLINE GHOST YET - RACING YOUR BEST', 2200); return; }
        this.topInfo = t;
        this.top = new GhostRunner(this, t.ghost, TOP_TINT);
        this.topStatus = 'ready';
        if (this.ghostMode !== 'mine' && this.ghostMode !== 'off') this.showFlash(`RACING ${shortName(t.name)}  ${formatTime(t.ghost.time)}`, 2200);
      });
      if (local) void syncGhost(board, getName(), local); // make sure the player's own best run is online too
    }
    const label = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff', stroke: '#14121f', strokeThickness: 2 };
    this.deltaMine = this.add.text(GAME_WIDTH / 2, 15, '', label).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
    this.deltaTop = this.add.text(GAME_WIDTH / 2, 25, '', label).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
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
    const racing = this.state === 'racing';
    const mode = this.ghostMode;
    // "Top player" with no online ghost available falls back to your own best run.
    const topGone = !this.top && this.topStatus !== 'loading';
    const showMine = mode === 'mine' || mode === 'both' || (mode === 'top' && topGone);
    const showTop = mode === 'top' || mode === 'both';
    const show = (text: Phaser.GameObjects.Text, label: string, d: number | null) => {
      if (d === null) text.setText('');
      else text.setText(`${label} ${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(2)}`).setColor(d > 0 ? '#e63946' : '#52b788');
    };
    show(this.deltaMine, 'BEST', this.mine?.update(this.raceTime, this.maxTotal, showMine, racing) ?? null);
    show(this.deltaTop, 'TOP', this.top?.update(this.raceTime, this.maxTotal, showTop, racing) ?? null);
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
    const run = { time: this.raceTime, carId: selectedCar().id, frames: this.rec };
    void this.submitOnline(Math.round(this.raceTime * 1000), async () => ((await uploadGhost(this.track.id, getName(), run)) ? 'Ghost uploaded' : undefined));
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

  /** One or two short lines on who you're racing, only for ghosts that are switched on. */
  private ghostLines(): string[] {
    const m = this.ghostMode;
    if (m === 'off') return [];
    const out: string[] = [];
    if ((m === 'mine' || m === 'both') && this.mine) out.push(`vs MY BEST  ${formatTime(this.mine.data.time)}`);
    if (m === 'top' || m === 'both') {
      out.push(this.topStatus === 'ready' && this.topInfo
        ? `vs ${shortName(this.topInfo.name)}  ${formatTime(this.topInfo.ghost.time)}`
        : this.topStatus === 'loading' ? 'vs TOP: loading...' : 'vs TOP: none yet');
    }
    return out;
  }

  protected pauseInfo(): { title: string; lines: string[] } {
    return {
      title: 'PAUSED',
      lines: [
        this.track.name,
        `Lap ${this.lapNumber()}/${this.track.laps}   ${formatTime(this.raceTime)}`,
        ...this.ghostLines(),
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
