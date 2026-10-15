// Pure maths (no Phaser) so the endless-road generator can be tested under node.

export const STEP = 4; // px between road samples

/**
 * The road may never point further than this from +x. Because |heading| < pi/2 the road always makes
 * forward progress in x (at least STEP * cos(MAX_HEADING) per sample), so it can never double back on itself.
 */
export const MAX_HEADING = 1.0;

const RATE = 0.0008; // max change of curvature per sample
const TRIGGER = 0.9 * MAX_HEADING;

export interface GenPt {
  x: number;
  y: number;
  half: number;
}

/** Road half-width (px) at a given sample count: starts wide and narrows over the first ~900 m. */
export function halfWidthAt(count: number): number {
  const t = Math.min(1, (count * STEP) / 9000);
  return 46 + (27 - 46) * t;
}

/** Tightest allowed curvature at a given half-width. */
export const maxCurvature = (half: number): number => 1 / Math.max(half * 1.6, 44);

/** Endless road as a curvature random-walk. Deterministic for a given `rand`. */
export class RoadGenerator {
  private x = 0;
  private y = 0;
  private heading = 0;
  private curv = 0;
  private target = 0;
  private left = 30; // samples until the next curvature decision (starts with a straight)
  private sign = 1;
  private count = 0;

  private readonly rand: () => number;

  constructor(rand: () => number) {
    this.rand = rand;
  }

  next(): GenPt {
    const half = halfWidthAt(this.count);
    const maxC = maxCurvature(half);

    if (this.left <= 0) {
      this.sign = this.rand() < 0.7 ? -this.sign : this.sign;
      this.target = this.rand() < 0.22 ? 0 : this.sign * maxC * (0.4 + 0.6 * this.rand());
      this.left = 22 + Math.floor(this.rand() * 45);
    }

    // Look ahead: if we started easing the curvature to zero right now, where would the heading
    // settle? If that is past the limit and we're still bending that way, turn back instead.
    const settle = ((this.curv * Math.abs(this.curv)) / (2 * RATE)) * STEP;
    const projected = this.heading + settle;
    const pushing = Math.sign(this.curv || this.target);
    if (Math.abs(projected) > TRIGGER && pushing === Math.sign(projected)) {
      this.target = -pushing * maxC * 0.5;
      this.sign = -pushing;
    }

    const dc = Math.max(-RATE, Math.min(RATE, this.target - this.curv));
    this.curv = Math.max(-maxC, Math.min(maxC, this.curv + dc));
    // Hard safety net: the look-ahead keeps us inside this, the clamp guarantees it.
    this.heading = Math.max(-MAX_HEADING, Math.min(MAX_HEADING, this.heading + this.curv * STEP));
    this.x += Math.cos(this.heading) * STEP;
    this.y += Math.sin(this.heading) * STEP;
    this.left--;
    this.count++;
    return { x: this.x, y: this.y, half };
  }
}
