import Phaser from 'phaser';
import type { RoadPt } from './Track';

/** Closer than this (px, centre to centre) and the player is busted. */
export const CATCH_RADIUS = 11;

const TURN_RATE = 3.2; // rad/s
const ACCEL = 160; // px/s^2
const FOLLOW = 8; // road samples the cruiser aims ahead of itself
const CHASE_RANGE = 70; // within this many px it stops following the road and drives straight at you

/** A police cruiser: follows the road towards the player, then rams straight in when close. */
export class PoliceCar {
  readonly sprite: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private idx: number;
  private speed = 0;

  constructor(scene: Phaser.Scene, pts: RoadPt[], idx: number) {
    this.idx = idx;
    const p = pts[idx];
    const q = pts[idx + 3];
    const heading = Math.atan2(q.y - p.y, q.x - p.x);
    this.shadow = scene.add.image(p.x, p.y, 'police-shadow').setDepth(9).setAlpha(0.35).setRotation(heading);
    this.sprite = scene.add.image(p.x, p.y, 'police-a').setDepth(10).setRotation(heading);
  }

  get x(): number { return this.sprite.x; }
  get y(): number { return this.sprite.y; }

  distanceTo(x: number, y: number): number {
    return Math.hypot(x - this.sprite.x, y - this.sprite.y);
  }

  /** `carIdx` is the player's nearest road sample; `top` is this cruiser's top speed in px/s. */
  update(dt: number, now: number, pts: RoadPt[], carIdx: number, car: { x: number; y: number }, top: number): void {
    let x = this.sprite.x;
    let y = this.sprite.y;
    while (this.idx < carIdx && Math.hypot(pts[this.idx + 1].x - x, pts[this.idx + 1].y - y) < 24) this.idx++;

    const direct = this.distanceTo(car.x, car.y) < CHASE_RANGE || this.idx >= carIdx - FOLLOW;
    const target = direct ? car : pts[Math.min(this.idx + FOLLOW, carIdx)];
    const want = Math.atan2(target.y - y, target.x - x);
    const diff = Phaser.Math.Angle.Wrap(want - this.sprite.rotation);
    const heading = this.sprite.rotation + Phaser.Math.Clamp(diff, -TURN_RATE * dt, TURN_RATE * dt);

    const goal = Math.abs(diff) > 1.2 ? top * 0.5 : top; // ease off through sharp turns
    this.speed += Phaser.Math.Clamp(goal - this.speed, -ACCEL * 2 * dt, ACCEL * dt);
    x += Math.cos(heading) * this.speed * dt;
    y += Math.sin(heading) * this.speed * dt;

    this.sprite.setPosition(x, y).setRotation(heading).setTexture(Math.floor(now / 160) % 2 ? 'police-b' : 'police-a');
    this.shadow.setPosition(x + 1, y + 2).setRotation(heading);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}
