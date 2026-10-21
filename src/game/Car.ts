import Phaser from 'phaser';
import type { CarStats } from './cars';
import { CarPhysics } from './carPhysics';

/**
 * Top-down drift car: the sprite, its shadow and a thin wrapper over CarPhysics, which holds all of the
 * movement maths (so it can be run headlessly by scripts/sim.ts).
 */
export class Car {
  readonly sprite: Phaser.GameObjects.Image;
  readonly phys: CarPhysics;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly vel = new Phaser.Math.Vector2();

  constructor(scene: Phaser.Scene, x: number, y: number, heading: number, stats: CarStats, texture: string, shadowTexture = `${texture}-shadow`) {
    this.phys = new CarPhysics(stats, x, y, heading);
    this.shadow = scene.add.image(x, y, shadowTexture).setDepth(9).setAlpha(0.35);
    this.sprite = scene.add.image(x, y, texture).setDepth(10);
    this.sync();
  }

  get stats(): CarStats { return this.phys.stats; }
  get facing(): number { return this.phys.heading; }
  get x(): number { return this.phys.x; }
  get y(): number { return this.phys.y; }
  get speed(): number { return this.phys.speed; }
  get slip(): number { return this.phys.slip; }

  get heat(): number { return this.phys.heat; }
  set heat(v: number) { this.phys.heat = v; }

  /** Set each frame by the scene; grass slows the car down. */
  get offRoad(): boolean { return this.phys.offRoad; }
  set offRoad(v: boolean) { this.phys.offRoad = v; }

  /** On a gravel section of the road (set by the scene). */
  get rough(): boolean { return this.phys.rough; }
  set rough(v: boolean) { this.phys.rough = v; }

  /** Current velocity in px/s (world axes). Treat as read-only. */
  get velocity(): Phaser.Math.Vector2 {
    return this.vel.set(this.phys.vx, this.phys.vy);
  }

  /** Put the car back on the road, stationary. */
  reset(x: number, y: number, heading: number): void {
    this.phys.reset(x, y, heading);
    this.sync();
  }

  /** World position of a point on the car body (forward/side offsets in px). */
  point(fwd: number, side: number): Phaser.Math.Vector2 {
    const c = Math.cos(this.phys.heading);
    const s = Math.sin(this.phys.heading);
    return new Phaser.Math.Vector2(this.x + c * fwd - s * side, this.y + s * fwd + c * side);
  }

  update(dt: number, throttle: number, steer: number, boosting = false, handbrake = false): void {
    this.phys.step(dt, throttle, steer, boosting, handbrake);
    this.sync();
  }

  private sync(): void {
    this.sprite.setPosition(this.phys.x, this.phys.y).setRotation(this.phys.heading);
    this.shadow.setPosition(this.phys.x + 1, this.phys.y + 2).setRotation(this.phys.heading);
  }
}
