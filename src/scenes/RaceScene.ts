import Phaser from 'phaser';
import { RACE_PAY } from '../game/cars';
import { GAME_WIDTH, SceneKey } from '../game/config';
import { GHOST_DT, getGhostMode, loadGhost, q1, saveGhostIfBest, type GhostMode } from '../game/ghost';
import { GhostRunner } from '../game/GhostRunner';
import { getName } from '../game/player';
import { fetchTopGhosts, syncGhost, uploadGhost, type OnlineGhost } from '../net/ghosts';
import { firebaseConfigured } from '../net/firebase';
import { selectedCar } from '../game/profile';
import { surfaceFlags, type SurfaceFlags } from '../game/surfaces';
import { formatClock, formatTime, getRecord, submitRace } from '../game/records';
import type { Pt } from '../game/spline';
import { buildTrack, type RoadPt } from '../game/Track';
import { TRACKS, type TrackDef } from '../game/tracks';
import { DriveScene, type Spawn } from './DriveScene';
import { audio } from '../game/audio';
import type { RunStats } from '../game/challenges';
import { MEDAL_COLOR, MEDAL_NAME, MEDAL_PAY, medalFor, medalTimes } from '../game/medals';

const WINDOW = 40; // samples searched either side of the last known position

const MINE_TINT = 0xbfe9ff;
const TOP_TINT = 0xffd166;
const PODIUM_TINTS = [0xffd166, 0xdfe6ee, 0xe0985a]; // gold, silver, bronze for TOP 3
const shortName = (n: string) => n.slice(0, 8).toUpperCase();

/** Circuit race: N laps, lap timing, personal bests. */
export class RaceScene extends DriveScene {
  protected calm = true;
  /** Ghost cars and the online top replay; off for head-to-head races. */
  protected useGhosts = true;
  protected track!: TrackDef;
  protected samples: RoadPt[] = [];
  private flags: SurfaceFlags[] = [];
  protected idx = 0;
  protected total = 0; // signed samples travelled relative to the start line
  protected maxTotal = 0;
  protected lapStart = 0;
  protected lapTimes: number[] = [];
  protected bestLap = Infinity;
  protected finishPayout = 0;
  protected finished = false; // for the challenge stats
  protected medalWon = 0;
  private medalGoal: { name: string; color: string; time: number } | null = null;

  // Ghosts: your best run, and the fastest uploaded run; plus a recording of this one.
  private mine: GhostRunner | null = null;
  private top: GhostRunner | null = null;
  private topInfo: OnlineGhost | null = null;
  /** TOP 3 mode: the 2nd and 3rd fastest replays (the fastest is `top`). */
  private chasers: { info: OnlineGhost; runner: GhostRunner; delta: Phaser.GameObjects.Text }[] = [];
  private topStatus: 'loading' | 'ready' | 'none' | 'error' | 'offline' = 'loading';
  private ghostMode: GhostMode = 'mine';
  private runToken = 0; // lets a late network reply tell it belongs to a scene that has since restarted
  private rec: number[] = [];
  private nextRec = 0;
  private deltaMine!: Phaser.GameObjects.Text;
  private deltaTop!: Phaser.GameObjects.Text;

  constructor(key: string = SceneKey.Race) {
    super(key);
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
    this.finished = false;
    this.medalWon = 0;
    const record = getRecord(this.track.id);
    this.bestLap = record.bestLap ?? Infinity;
    // The next medal up from your best time on this track (shown in the corner while you race).
    const have = medalFor(this.track.id, record.best);
    const mt = medalTimes(this.track.id);
    this.medalGoal = mt && have < 3 ? { name: MEDAL_NAME[have + 1], color: MEDAL_COLOR[have + 1], time: [0, mt.bronze, mt.silver, mt.gold][have + 1] } : null;

    this.rec = [];
    this.nextRec = 0;
    const board = this.track.id;
    const token = ++this.runToken;
    const local = this.useGhosts ? loadGhost(board) : null;
    this.mine = local ? new GhostRunner(this, local, MINE_TINT) : null;
    this.top = null;
    this.topInfo = null;
    this.chasers = [];
    this.ghostMode = getGhostMode();
    this.topStatus = firebaseConfigured ? 'loading' : 'offline';
    if (firebaseConfigured && this.useGhosts) {
      const want = this.ghostMode === 'top3' ? 3 : 1;
      void fetchTopGhosts(board, want).then((list) => {
        if (token !== this.runToken || !this.scene.isActive()) return;
        if (list === 'error' || !list.length) {
          this.topStatus = list === 'error' ? 'error' : 'none';
          if (this.ghostMode === 'top' || this.ghostMode === 'top3') this.showFlash(list === 'error' ? "CAN'T REACH ONLINE GHOSTS - RACING YOUR BEST" : 'NO ONLINE GHOST YET - RACING YOUR BEST', 2400);
          return;
        }
        const t = list[0];
        this.topInfo = t;
        this.top = new GhostRunner(this, t.ghost, want > 1 ? PODIUM_TINTS[0] : TOP_TINT);
        const small = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff', stroke: '#14121f', strokeThickness: 2 };
        this.chasers = list.slice(1).map((info, i) => ({
          info,
          runner: new GhostRunner(this, info.ghost, PODIUM_TINTS[i + 1]),
          delta: this.add.text(GAME_WIDTH / 2, 35 + i * 10, '', small).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100),
        }));
        this.topStatus = 'ready';
        if (this.ghostMode === 'top3') this.showFlash(`RACING TOP ${list.length}  ${list.map((g) => shortName(g.name)).join(' ')}`, 2600);
        else if (this.ghostMode !== 'mine' && this.ghostMode !== 'off') this.showFlash(`RACING ${shortName(t.name)}  ${formatTime(t.ghost.time)}`, 2200);
      });
      if (local) void syncGhost(board, getName(), local); // make sure the player's own best run is online too
    }
    const label = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff', stroke: '#14121f', strokeThickness: 2 };
    this.deltaMine = this.add.text(GAME_WIDTH / 2, 15, '', label).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
    this.deltaTop = this.add.text(GAME_WIDTH / 2, 25, '', label).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
    return this.pointAt(this.idx);
  }

  protected pointAt(i: number): Spawn {
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
    const showMine = mode === 'mine' || mode === 'both' || ((mode === 'top' || mode === 'top3') && topGone);
    const showTop = mode === 'top' || mode === 'top3' || mode === 'both';
    const show = (text: Phaser.GameObjects.Text, label: string, d: number | null) => {
      if (d === null) text.setText('');
      else text.setText(`${label} ${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(2)}`).setColor(d > 0 ? '#e63946' : '#52b788');
    };
    show(this.deltaMine, 'BEST', this.mine?.update(this.raceTime, this.maxTotal, showMine, racing) ?? null);
    show(this.deltaTop, mode === 'top3' ? '#1' : 'TOP', this.top?.update(this.raceTime, this.maxTotal, showTop, racing) ?? null);
    this.chasers.forEach((c, i) => show(c.delta, `#${i + 2}`, c.runner.update(this.raceTime, this.maxTotal, mode === 'top3', racing)));
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
    const gap = this.bestLap < Infinity ? lapTime - this.bestLap : null; // against your best lap before this one
    if (isBest) this.bestLap = lapTime;

    if (k >= this.track.laps) {
      this.finishRace();
    } else {
      const split = gap === null ? '' : `  ${gap <= 0 ? '-' : '+'}${Math.abs(gap).toFixed(2)}`;
      this.showFlash(`LAP ${k}  ${formatTime(lapTime)}${split}${isBest ? '  BEST!' : ''}`, 1800, gap !== null && gap > 0 ? '#e63946' : '#52b788');
      if (isBest) audio.sfx('bank');
    }
  }

  protected finishRace(): void {
    const bestThisRun = Math.min(...this.lapTimes);
    const oldMedal = medalFor(this.track.id, getRecord(this.track.id).best);
    const r = submitRace(this.track.id, this.raceTime, bestThisRun);
    this.finished = true;
    this.medalWon = medalFor(this.track.id, this.raceTime);
    const lines = [`Laps  ${this.lapTimes.map((t) => t.toFixed(2)).join('  ')}`];
    lines.push(`Total   ${formatTime(this.raceTime)}${r.newBest ? '  NEW RECORD!' : ''}`);
    lines.push(`Best lap ${formatTime(bestThisRun)}${r.newLap ? '  NEW RECORD!' : ''}`);
    const base = RACE_PAY[this.track.difficulty];
    // The first time you reach a medal on a track pays a bonus for every tier you newly cleared.
    let medalPay = 0;
    for (let tier = oldMedal + 1; tier <= this.medalWon; tier++) medalPay += MEDAL_PAY[tier];
    const mt = medalTimes(this.track.id);
    if (mt) {
      const next = this.medalWon < 3 ? `  next ${MEDAL_NAME[this.medalWon + 1]} ${formatClock([0, mt.bronze, mt.silver, mt.gold][this.medalWon + 1])}` : '';
      lines.push(`${this.medalWon ? `Medal  ${MEDAL_NAME[this.medalWon]}${medalPay ? `  +${medalPay}` : ''}` : 'No medal'}${next}`);
    }
    this.finishPayout = base + (r.newBest ? Math.floor(base / 2) : 0) + medalPay;
    this.settle();
    lines.push(`Coins +${this.coinsPaid}  (finish ${this.finishPayout}, drift ${Math.floor(this.driftBank)})`);
    if (this.medalWon > oldMedal) {
      audio.sfx('medal');
      this.showFlash(`${MEDAL_NAME[this.medalWon]} MEDAL!`, 4000, MEDAL_COLOR[this.medalWon]);
      this.confetti(this.medalWon === 3 ? 110 : 70);
    } else if (r.newBest) {
      audio.sfx('best');
      this.showFlash('NEW RECORD!', 4000, '#52b788');
      this.confetti(60);
    }
    if (saveGhostIfBest(this.track.id, { time: this.raceTime, carId: selectedCar().id, frames: this.rec })) {
      lines.push('Ghost saved');
    }
    this.finish('FINISHED', lines);
    const run = { time: this.raceTime, carId: selectedCar().id, frames: this.rec };
    void this.submitOnline(Math.round(this.raceTime * 1000), async () => ((await uploadGhost(this.track.id, getName(), run)) ? 'Ghost uploaded' : undefined));
  }

  protected lapNumber(): number {
    return Phaser.Math.Clamp(Math.floor(this.maxTotal / this.samples.length) + 1, 1, this.track.laps);
  }

  protected hudLines(): string[] {
    const lines = [`LAP ${this.lapNumber()}/${this.track.laps}  ${formatClock(this.raceTime)}`];
    if (this.bestLap < Infinity) lines.push(`BEST ${formatClock(this.bestLap)}`);
    if (this.medalGoal && !this.finished) lines.push(`${this.medalGoal.name} ${formatClock(this.medalGoal.time)}`);
    return lines;
  }

  protected modeStats(): Partial<RunStats> {
    return { mode: 'race', trackId: this.track.id, finished: this.finished, medal: this.medalWon };
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
    if (m === 'top3' && this.topStatus === 'ready' && this.topInfo) {
      for (const [i, g] of [this.topInfo, ...this.chasers.map((c) => c.info)].entries()) out.push(`#${i + 1} ${shortName(g.name)}  ${formatTime(g.ghost.time)}`);
    } else if (m === 'top' || m === 'top3' || m === 'both') {
      out.push(this.topStatus === 'ready' && this.topInfo
        ? `vs ${shortName(this.topInfo.name)}  ${formatTime(this.topInfo.ghost.time)}`
        : this.topStatus === 'loading' ? 'vs TOP: loading...' : this.topStatus === 'error' ? 'vs TOP: offline' : 'vs TOP: none yet');
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
