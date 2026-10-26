/**
 * Smooth playback of another driver's car from the position updates they send.
 *
 * Updates arrive a few times a second and unevenly (network jitter, batching), so drawing "the latest update" or
 * guessing ahead from it makes the car jump forward and snap back. Instead every update is kept with the time the
 * sender stamped on it, and the car is drawn a short, fixed time in the past, tweened between the two updates on
 * either side of that moment. The result is always smooth; the price is that opponents are shown that much behind.
 */

export interface Snap {
  /** The sender's clock (ms) when the position was recorded. */
  t: number;
  x: number;
  y: number;
  /** Heading, radians. */
  h: number;
}

const KEEP = 40; // snapshots kept (a few seconds)
const MIN_DELAY = 120; // ms behind real time, however steady the connection
const MAX_DELAY = 600;
const EXTRAPOLATE_MS = 120; // if the buffer runs dry, keep going on the last velocity for this long, then hold

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

export class SnapshotBuffer {
  private snaps: Snap[] = [];
  /** Smallest (arrival time - sender time) seen: the sender's clock offset plus the fastest trip, in ms. */
  private offset = Infinity;
  /** Smoothed time between updates (ms), which sets how far behind we need to draw. */
  private interval = 100;
  /** The moment (sender's clock) being drawn: it ticks along with real time and is only nudged towards the target. */
  private playT = NaN;
  private lastWall = NaN;

  get length(): number {
    return this.snaps.length;
  }

  /** How far behind real time the car is drawn (ms). */
  get delay(): number {
    return Math.min(MAX_DELAY, Math.max(MIN_DELAY, this.interval * 2.2));
  }

  /** `recvWall` is the receiver's clock (ms) when the update arrived. Out-of-order and duplicate updates are dropped. */
  add(s: Snap, recvWall: number): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.t <= last.t) return;
    if (last) this.interval += (Math.min(s.t - last.t, 1000) - this.interval) * 0.1;
    this.offset = Math.min(this.offset, recvWall - s.t);
    this.snaps.push(s);
    if (this.snaps.length > KEEP) this.snaps.shift();
  }

  /** Where the car should be drawn at receiver time `nowWall`, or null before the first update. */
  sample(nowWall: number): { x: number; y: number; h: number } | null {
    const n = this.snaps.length;
    if (!n) return null;
    const target = nowWall - this.offset - this.delay; // the moment we ought to be showing, on the sender's clock
    // The target moves around as the delay and clock offset are re-estimated. Jumping to it would make the car lurch,
    // so the drawn moment runs at real speed and is steered towards the target a few percent per frame instead.
    if (Number.isNaN(this.playT) || Math.abs(target - this.playT) > 1000) this.playT = target;
    else this.playT += (nowWall - this.lastWall) + (target - this.playT) * 0.06;
    this.lastWall = nowWall;
    const t = this.playT;
    const first = this.snaps[0];
    const last = this.snaps[n - 1];
    if (t <= first.t) return { x: first.x, y: first.y, h: first.h };
    if (t >= last.t) {
      const prev = this.snaps[n - 2];
      if (!prev) return { x: last.x, y: last.y, h: last.h };
      const span = last.t - prev.t;
      const ahead = Math.min(t - last.t, EXTRAPOLATE_MS);
      const k = span > 0 ? ahead / span : 0;
      return { x: last.x + (last.x - prev.x) * k, y: last.y + (last.y - prev.y) * k, h: wrap(last.h + wrap(last.h - prev.h) * k) };
    }
    let i = n - 2;
    while (i > 0 && this.snaps[i].t > t) i--;
    const a = this.snaps[i];
    const b = this.snaps[i + 1];
    const k = (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: wrap(a.h + wrap(b.h - a.h) * k) };
  }
}
