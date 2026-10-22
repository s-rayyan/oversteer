import Phaser from 'phaser';
import { RACE_PAY } from '../game/cars';
import { SceneKey } from '../game/config';
import { audio } from '../game/audio';
import type { RunStats } from '../game/challenges';
import { formatClock, formatTime } from '../game/records';
import type { OverlayEntry } from '../game/ui';
import { pvp, type Live, type Member } from '../net/pvp';
import { RaceScene } from './RaceScene';

const SEND_MS = 150; // how often our position is broadcast (~7 a second)
const LAG_CAP = 0.3; // seconds an opponent is extrapolated ahead of their last update
const SMOOTH = 14; // how fast a drawn opponent chases where it should be (per second)
const GONE_MS = 7000; // no updates for this long and they've dropped out
const CLEAR_DELAY_MS = 15000; // how long our live record lingers after we leave the race
const GRACE_MS = 2200; // after we cross the line, wait this long for a finish report that is still in flight
const SLOT_COLOR = [0xffd166, 0xe63946, 0x52b788, 0x4895ef];
const SLOT_CSS = ['#ffd166', '#e63946', '#52b788', '#4895ef'];
const ORDINAL = ['', '1ST', '2ND', '3RD', '4TH'];
const PLACE_PAY = [0, 1.5, 1, 0.5, 0.5]; // share of the track's race pay by finishing place

interface Opponent {
  uid: string;
  slot: number;
  name: string;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  x: number; y: number; h: number; // where it is drawn
  tx: number; ty: number; th: number; // last reported
  vx: number; vy: number;
  seenAt: number; // when the last update arrived (performance.now)
  progress: number;
  /** Reported finish time in seconds. */
  fin: number | null;
  out: boolean; // quit, or went quiet
  seen: boolean;
}

/** Head-to-head race on a circuit: the other drivers are live cars (no collisions), the first across the line wins. */
export class PvpScene extends RaceScene {
  protected useGhosts = false;
  protected pausable = false;
  protected restartLabel = 'Leave race';

  private roomId = '';
  private roster: Record<string, Member> = {};
  private myUid = '';
  private slot = 0;
  private opps = new Map<string, Opponent>();
  private unwatch: (() => void) | null = null;
  private lastSend = 0;
  private finishedAt = 0; // performance.now() when we crossed the line
  private myTime = 0;
  private place = 0;
  private resolved = false;
  private panelText = '';

  constructor() {
    super(SceneKey.Pvp);
  }

  init(data: { trackId?: string; roomId: string; roster: Record<string, Member>; me: string }): void {
    super.init(data);
    this.roomId = data.roomId;
    this.roster = data.roster;
    this.myUid = data.me;
    this.slot = Math.max(0, Object.keys(this.roster).sort().indexOf(this.myUid));
  }

  protected setupWorld() {
    const sp = super.setupWorld();
    // Starting grid: two abreast, staggered back.
    const lat = this.slot % 2 ? 13 : -13;
    const back = Math.floor(this.slot / 2) * 24;
    const nx = -Math.sin(sp.heading);
    const ny = Math.cos(sp.heading);
    return { x: sp.x + nx * lat - Math.cos(sp.heading) * back, y: sp.y + ny * lat - Math.sin(sp.heading) * back, heading: sp.heading };
  }

  create(): void {
    this.opps.clear();
    this.finishedAt = 0;
    this.myTime = 0;
    this.place = 0;
    this.resolved = false;
    this.panelText = '';
    this.lastSend = 0;
    super.create();
    this.hint.setText('SPACE boost  X handbrake  ENTER respawn  M mute');

    const uids = Object.keys(this.roster).sort();
    uids.forEach((uid, slot) => {
      if (uid === this.myUid) return;
      const m = this.roster[uid];
      const key = `car-${m.carId}`;
      const sprite = this.add.image(0, 0, this.textures.exists(key) ? key : 'car-hatch').setDepth(9.8).setVisible(false);
      const label = this.add.text(0, 0, m.name.slice(0, 10).toUpperCase(), {
        fontFamily: 'monospace', fontSize: '7px', color: SLOT_CSS[slot], stroke: '#14121f', strokeThickness: 2,
      }).setOrigin(0.5).setDepth(9.9).setVisible(false);
      this.opps.set(uid, {
        uid, slot, name: m.name, sprite, label, x: 0, y: 0, h: 0, tx: 0, ty: 0, th: 0, vx: 0, vy: 0,
        seenAt: 0, progress: -Infinity, fin: null, out: false, seen: false,
      });
    });

    this.unwatch = pvp().watchLive(this.roomId, (uid, s) => this.onLive(uid, s));
    this.events.once('shutdown', () => {
      this.unwatch?.();
      this.unwatch = null;
      if (!this.finished) this.send(true); // tell the others we've gone
      // Remove our live record once the others have had time to read our finish; a closed tab leaves it for the next clean-up.
      const room = this.roomId;
      window.setTimeout(() => void pvp().clear(room).catch(() => undefined), CLEAR_DELAY_MS);
    });
  }

  // ---- other drivers ----

  private onLive(uid: string, s: Live): void {
    const o = this.opps.get(uid);
    if (!o) return;
    const now = performance.now();
    if (o.seen) {
      const dt = Math.max(0.05, (now - o.seenAt) / 1000);
      o.vx = Phaser.Math.Clamp((s.x - o.tx) / dt, -900, 900);
      o.vy = Phaser.Math.Clamp((s.y - o.ty) / dt, -900, 900);
    } else {
      o.x = s.x; o.y = s.y; o.h = s.h;
      o.seen = true;
    }
    o.tx = s.x; o.ty = s.y; o.th = s.h;
    o.seenAt = now;
    o.progress = s.p;
    o.out = s.d && s.t === null;
    if (s.t !== null && o.fin === null) o.fin = s.t / 1000;
  }

  private moveOpponents(dt: number): void {
    const now = performance.now();
    const k = 1 - Math.exp(-SMOOTH * dt);
    for (const o of this.opps.values()) {
      if (!o.seen) continue;
      if (o.fin === null && !o.out && this.state === 'racing' && now - o.seenAt > GONE_MS) o.out = true;
      const age = Math.min((now - o.seenAt) / 1000, LAG_CAP);
      const gx = o.tx + (o.fin === null ? o.vx * age : 0);
      const gy = o.ty + (o.fin === null ? o.vy * age : 0);
      if (Phaser.Math.Distance.Between(o.x, o.y, gx, gy) > 300) { o.x = gx; o.y = gy; }
      o.x += (gx - o.x) * k;
      o.y += (gy - o.y) * k;
      o.h += Phaser.Math.Angle.Wrap(o.th - o.h) * k;
      o.sprite.setPosition(o.x, o.y).setRotation(o.h).setVisible(!o.out).setAlpha(o.fin !== null ? 0.6 : 1);
      o.label.setPosition(o.x, o.y - 13).setVisible(!o.out);
    }
  }

  private send(gone = false): void {
    const t = this.finished ? Math.round(this.myTime * 1000) : null;
    const s: Live = {
      x: Math.round(this.car.x * 10) / 10, y: Math.round(this.car.y * 10) / 10, h: Math.round(this.car.facing * 1000) / 1000,
      p: this.maxTotal, t, d: gone, at: Date.now(),
    };
    void pvp().push(this.roomId, s).catch(() => undefined);
  }

  // ---- running order ----

  /** Everyone in finishing order: crossed the line (by time), then still racing (by distance), then dropped out. */
  private standings(): Array<{ name: string; mine: boolean; slot: number; fin: number | null; out: boolean; progress: number }> {
    const all = [
      { name: this.roster[this.myUid]?.name ?? 'YOU', mine: true, slot: this.slot, fin: this.finished ? this.myTime : null, out: false, progress: this.maxTotal },
      ...[...this.opps.values()].map((o) => ({ name: o.name, mine: false, slot: o.slot, fin: o.fin, out: o.out, progress: o.seen ? o.progress : -Infinity })),
    ];
    const rank = (r: (typeof all)[number]) => (r.fin !== null ? 0 : r.out ? 2 : 1);
    return all.sort((a, b) => rank(a) - rank(b) || (a.fin !== null && b.fin !== null ? a.fin - b.fin : b.progress - a.progress) || a.slot - b.slot);
  }

  private position(): number {
    return this.standings().findIndex((r) => r.mine) + 1;
  }

  protected afterUpdate(): void {
    const dt = this.game.loop.delta / 1000;
    super.afterUpdate();
    this.moveOpponents(dt);

    const now = performance.now();
    const sending = this.state !== 'finished' || (this.finishedAt && now - this.finishedAt < 1500);
    if (sending && now - this.lastSend >= SEND_MS) {
      this.lastSend = now;
      this.send();
    }
    if (this.finished && !this.resolved && now - this.finishedAt >= GRACE_MS) this.resolve();
    if (this.finished) this.refreshPanel();
  }

  // ---- finishing ----

  protected finishRace(): void {
    this.finished = true;
    this.myTime = this.raceTime;
    this.finishedAt = performance.now();
    this.lastSend = this.finishedAt;
    this.send(); // the finish report goes out right away
    this.finish('FINISHED', this.panelLines());
  }

  /** Our place is settled a moment after the line: nobody not yet over it can have beaten our time. */
  private resolve(): void {
    this.resolved = true;
    const rivals = [...this.opps.values()];
    this.place = 1 + rivals.filter((o) => o.fin !== null && o.fin < this.myTime).length;
    const contested = rivals.some((o) => o.seen && o.progress > 20);
    const base = RACE_PAY[this.track.difficulty];
    this.finishPayout = Math.round(base * (contested ? PLACE_PAY[Math.min(this.place, 4)] : 0.25));
    this.settle();
    if (contested && this.place === 1) {
      audio.sfx('best');
      this.showFlash('YOU WIN!', 4000, '#52b788');
      this.confetti(90);
    } else if (contested) {
      audio.sfx('bank');
      this.showFlash(`${ORDINAL[Math.min(this.place, 4)]} PLACE`, 3000, '#ffd166');
    }
    this.refreshPanel(true);
  }

  private panelLines(): string[] {
    const lines: string[] = [];
    if (this.resolved) lines.push(this.opps.size && [...this.opps.values()].some((o) => o.seen && o.progress > 20) ? `${ORDINAL[Math.min(this.place, 4)]} of ${this.opps.size + 1}` : 'No one else raced');
    else lines.push('Waiting for the results...');
    this.standings().forEach((r, i) => {
      const time = r.fin !== null ? formatTime(r.fin) : r.out ? 'DROPPED OUT' : 'racing...';
      lines.push(`${i + 1} ${(r.mine ? '>' : ' ') + r.name.slice(0, 10).toUpperCase().padEnd(10)} ${time}`);
    });
    if (this.resolved) lines.push(`Coins +${this.coinsPaid}  (finish ${this.finishPayout}, drift ${Math.floor(this.driftBank)})`);
    return lines;
  }

  private refreshPanel(force = false): void {
    const lines = this.panelLines();
    const text = lines.join('\n');
    if (!force && text === this.panelText) return;
    this.panelText = text;
    this.setFinishLines(lines);
  }

  protected finishEntries(): OverlayEntry[] {
    return [
      { label: 'Race again', action: () => this.scene.start(SceneKey.PvpLobby, { trackId: this.track.id, auto: 'quick' }) },
      { label: 'Change track', action: () => this.scene.start(SceneKey.Menu) },
    ];
  }

  protected leaveEntries(): OverlayEntry[] {
    return [{ label: 'Leave race', action: () => this.scene.start(SceneKey.Menu) }];
  }

  protected restart(): void {
    this.showFlash('NO RESTARTS IN A RACE', 1200, '#e63946');
  }

  // ---- HUD ----

  protected hudLines(): string[] {
    const lines = [`LAP ${this.lapNumber()}/${this.track.laps}  ${formatClock(this.finished ? this.myTime : this.raceTime)}`];
    const st = this.standings();
    lines.push(`POS ${st.findIndex((r) => r.mine) + 1}/${st.length}`);
    if (this.state !== 'countdown') {
      st.forEach((r, i) => lines.push(`${i + 1}${r.mine ? '>' : ' '}${r.name.slice(0, 8).toUpperCase()}${r.fin !== null ? ' ' + formatClock(r.fin) : r.out ? ' OUT' : ''}`));
    }
    return lines;
  }

  protected mapRacers(): Array<{ x: number; y: number; color: number }> {
    return [...this.opps.values()].filter((o) => o.seen && !o.out).map((o) => ({ x: o.x, y: o.y, color: SLOT_COLOR[o.slot] }));
  }

  protected pauseInfo(): { title: string; lines: string[] } {
    return { title: 'RACE MENU', lines: [this.track.name, `Position ${this.position()}/${this.opps.size + 1}`, 'The race keeps going'] };
  }

  protected modeStats(): Partial<RunStats> {
    return { mode: 'race', trackId: this.track.id, finished: false, medal: 0 };
  }
}
