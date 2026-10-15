// Pure maths (no Phaser): the single source of truth for how a car moves. The game's Car class wraps
// this, and scripts/sim.ts runs the very same code headlessly to benchmark and balance cars.
import type { CarStats } from './cars.ts';

/** A car counts as drifting (charging boost, earning coins) above this slip and speed. */
export const DRIFT_SLIP = 0.18;
export const DRIFT_MIN_SPEED = 25;
/** Inside a drift zone, sliding charges boost this many times faster (and ignores tyre heat). */
export const ZONE_CHARGE_MULT = 2;

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export class CarPhysics {
  x = 0;
  y = 0;
  heading = 0; // radians
  vx = 0;
  vy = 0;
  /** 0..1 tyre heat: steering and the handbrake warm the tyres, hot tyres lose grip. */
  heat = 0;
  /** Set each frame by the scene; grass slows the car down. */
  offRoad = false;
  /** On a gravel section of the road: capped like grass (by offRoadCap) but without the grass drag. */
  rough = false;
  stats: CarStats;

  private readonly drag = 0.5;

  constructor(stats: CarStats, x = 0, y = 0, heading = 0) {
    this.stats = stats;
    this.x = x;
    this.y = y;
    this.heading = heading;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  /** Amount of sideways slip, roughly 0..1. */
  get slip(): number {
    const lateral = this.vx * -Math.sin(this.heading) + this.vy * Math.cos(this.heading);
    return (Math.abs(lateral) * this.heat) / this.stats.maxSpeed;
  }

  /** Sideways slip ignoring tyre heat. Used in drift zones, where low-grip cars charge boost freely. */
  get rawSlip(): number {
    const lateral = this.vx * -Math.sin(this.heading) + this.vy * Math.cos(this.heading);
    return Math.abs(lateral) / this.stats.maxSpeed;
  }

  /** True while sliding hard enough on the road to charge boost. */
  get drifting(): boolean {
    return !this.offRoad && this.slip > DRIFT_SLIP && this.speed > DRIFT_MIN_SPEED;
  }

  reset(x: number, y: number, heading: number): void {
    this.vx = 0;
    this.vy = 0;
    this.heading = heading;
    this.x = x;
    this.y = y;
  }

  step(dt: number, throttle: number, steer: number, boosting = false, handbrake = false): void {
    const s = this.stats;
    // Steering scales with speed so you can't spin on the spot.
    const speedFactor = clamp(this.speed / 40, 0, 1);
    // The handbrake unlocks the rear: sharper rotation, far less grip, and some scrubbed speed.
    this.heading += steer * s.turnRate * (handbrake ? 1.35 : 1) * speedFactor * dt;

    const fx = Math.cos(this.heading);
    const fy = Math.sin(this.heading);
    if (boosting) {
      const a = s.accel * s.boostAccel * dt;
      this.vx += fx * a;
      this.vy += fy * a;
    } else if (throttle > 0) {
      const a = s.accel * throttle * dt;
      this.vx += fx * a;
      this.vy += fy * a;
    } else if (throttle < 0) {
      const a = s.brake * throttle * dt;
      this.vx += fx * a;
      this.vy += fy * a;
    }
    if (!boosting && !handbrake) this.heat = Math.max(0, this.heat - 0.1 * dt); // cool down slowly

    // Kill lateral velocity gradually -> drift.
    const rx = -fy;
    const ry = fx;
    const lateral = this.vx * rx + this.vy * ry;
    // Hot tyres lose grip: nothing below ~0.55 heat, then a steep fall-off.
    const t = clamp(this.heat - 0.55, 0, 1);
    const heatGrip = 1 - 0.85 * t * t * (3 - 2 * t);
    const kill = lateral * Math.min(1, s.grip * heatGrip * (handbrake ? 0.2 : 1) * dt);
    this.vx -= rx * kill;
    this.vy -= ry * kill;
    if (handbrake) {
      const k = 1 - 0.8 * dt;
      this.vx *= k;
      this.vy *= k;
      this.heat = Math.min(1, this.heat + 0.025 * dt); // heat up slowly when handbraking
    }
    this.heat = Math.min(1, this.heat + Math.abs(steer / 5) * dt); // steering warms the tyres too

    const drag = 1 - (this.offRoad ? 2.2 - (s.offRoadCap - 0.4) * 3 : this.drag) * dt;
    this.vx *= drag;
    this.vy *= drag;

    const slow = this.offRoad || this.rough;
    const cap = (slow ? s.maxSpeed * s.offRoadCap : s.maxSpeed) * (boosting ? s.boostSpeed : 1);
    const sp = this.speed;
    if (sp > cap) {
      // Ease back to the cap so a boost ending (or hitting grass) doesn't snap the speed.
      const k = Math.min(1, (slow ? 5 : 2) * dt);
      const scale = (sp - (sp - cap) * k) / sp;
      this.vx *= scale;
      this.vy *= scale;
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }
}

/** Boost meter (0..1) while boosting. */
export function drainBoost(boost: number, stats: CarStats, dt: number): number {
  return Math.max(0, boost - stats.boostDrain * dt);
}

/** Boost meter (0..1) while drifting. */
export function chargeBoost(boost: number, slip: number, stats: CarStats, dt: number): number {
  return Math.min(1, boost + slip * stats.boostCharge * dt);
}
