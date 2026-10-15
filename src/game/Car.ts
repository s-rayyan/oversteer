import Phaser from 'phaser';
import type { CarStats } from './cars';

/**
 * Top-down drift car. Velocity is tracked separately from heading so that
 * lateral grip < 1 lets the car slide (oversteer).
 */
export class Car {
  readonly sprite: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private vel = new Phaser.Math.Vector2();
  private heading = 0; // radians
  public heat = 0; // 0..1, for boost overheating

  /** Set each frame by the scene; grass slows the car down. */
  offRoad = false;

  private readonly drag = 0.5;

  constructor(scene: Phaser.Scene, x: number, y: number, heading: number, readonly stats: CarStats, texture: string) {
    this.shadow = scene.add.image(x, y, `${texture}-shadow`).setDepth(9).setAlpha(0.35);
    this.sprite = scene.add.image(x, y, texture).setDepth(10);
    this.heading = heading;
    this.sync();
  }

  get facing(): number { return this.heading; }
  get x(): number { return this.sprite.x; }
  get y(): number { return this.sprite.y; }

  /** Current velocity in px/s (world axes). Treat as read-only. */
  get velocity(): Phaser.Math.Vector2 {
    return this.vel;
  }

  get speed(): number {
    return this.vel.length();
  }

  /** Amount of sideways slip, roughly 0..1. */
  get slip(): number {
    const r = new Phaser.Math.Vector2(-Math.sin(this.heading), Math.cos(this.heading));
    return Math.abs(this.vel.dot(r))* this.heat / this.stats.maxSpeed;
  }

  /** Put the car back on the road, stationary. */
  reset(x: number, y: number, heading: number): void {
    this.vel.set(0, 0);
    this.heading = heading;
    this.sprite.setPosition(x, y);
    this.sync();
  }

  /** World position of a point on the car body (forward/side offsets in px). */
  point(fwd: number, side: number): Phaser.Math.Vector2 {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    return new Phaser.Math.Vector2(this.x + c * fwd - s * side, this.y + s * fwd + c * side);
  }

  update(dt: number, throttle: number, steer: number, boosting = false, handbrake = false): void {
    // Steering scales with speed so you can't spin on the spot.
    const speedFactor = Phaser.Math.Clamp(this.speed / 40, 0, 1);
    // The handbrake unlocks the rear: sharper rotation, far less grip, and some scrubbed speed.
    this.heading += steer * this.stats.turnRate * (handbrake ? 1.35 : 1) * speedFactor * dt;

    const f = new Phaser.Math.Vector2(Math.cos(this.heading), Math.sin(this.heading));
    if (boosting) {
      this.vel.add(f.clone().scale(this.stats.accel * this.stats.boostAccel * dt));
    }
    else if (throttle > 0) this.vel.add(f.clone().scale(this.stats.accel * throttle * dt));
    else if (throttle < 0) this.vel.add(f.clone().scale(this.stats.brake * throttle * dt));
    if (!boosting && !handbrake) this.heat = Math.max(0, this.heat - 0.1 * dt); // Cool down slowly
    // Kill lateral velocity gradually -> drift.
    const r = new Phaser.Math.Vector2(-f.y, f .x);
    const lateral = this.vel.dot(r);
    // Hot tires lose grip: nothing below ~0.55 heat, then a steep fall-off (about half grip at 0.8, a quarter at 0.9).
    const t = Phaser.Math.Clamp((this.heat - 0.55), 0, 1);
    const heatGrip = 1 - 0.85 * t * t * (3 - 2 * t);
    this.vel.subtract(r.scale(lateral * Math.min(1, this.stats.grip * heatGrip * (handbrake ? 0.2 : 1) * dt)));
    if (handbrake) {
      this.vel.scale(1 - 0.8 * dt);
      this.heat = Math.min(1, this.heat + 0.025 * dt); // Heat up slowly when handbraking
    }
    this.heat = Math.min(1, this.heat + Math.abs(steer/5) * dt); // Heat up quickly when boosting
    this.vel.scale(1 - (this.offRoad ? 2.2 - (this.stats.offRoadCap - 0.4) * 3 : this.drag) * dt);

    const cap = (this.offRoad ? this.stats.maxSpeed * this.stats.offRoadCap : this.stats.maxSpeed) * (boosting ? this.stats.boostSpeed : 1);
    const sp = this.speed;
    if (sp > cap) {
      // Ease back to the cap so a boost ending (or hitting grass) doesn't snap the speed.
      const k = Math.min(1, (this.offRoad ? 5 : 2) * dt);
      this.vel.scale((sp - (sp - cap) * k) / sp);
    }

    this.sprite.x += this.vel.x * dt;
    this.sprite.y += this.vel.y * dt;
    this.sync();
  }

  private sync(): void {
    this.sprite.rotation = this.heading;
    this.shadow.setPosition(this.sprite.x + 1, this.sprite.y + 2).setRotation(this.heading);
  }
}
