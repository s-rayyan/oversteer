import Phaser from 'phaser';
import { CARS } from './cars';
import { GHOST_DT, GHOST_STRIDE, type GhostData } from './ghost';

/** Replays one recorded run as a translucent car, and measures how far ahead or behind it you are. */
export class GhostRunner {
  readonly sprite: Phaser.GameObjects.Image;
  private idx = 0;

  constructor(scene: Phaser.Scene, readonly data: GhostData, tint: number) {
    const key = `car-${data.carId}`;
    this.sprite = scene.add.image(0, 0, scene.textures.exists(key) ? key : `car-${CARS[0].id}`)
      .setAlpha(0.5).setTint(tint).setDepth(9.5).setVisible(false);
  }

  /**
   * Moves the ghost to `raceTime`. Returns your time delta in seconds (positive = behind the ghost), or null
   * when it isn't known (hidden, not racing, or the ghost hasn't reached where you are yet).
   */
  update(raceTime: number, progress: number, show: boolean, racing: boolean): number | null {
    const fr = this.data.frames;
    const n = fr.length / GHOST_STRIDE;
    const f = Math.max(0, raceTime) / GHOST_DT;
    const i = Math.min(Math.floor(f), n - 1);
    const j = Math.min(i + 1, n - 1);
    const k = Math.min(f - i, 1);
    const a = i * GHOST_STRIDE;
    const b = j * GHOST_STRIDE;
    this.sprite.setPosition(fr[a] + (fr[b] - fr[a]) * k, fr[a + 1] + (fr[b + 1] - fr[a + 1]) * k);
    this.sprite.setRotation(fr[a + 2] + Phaser.Math.Angle.Wrap(fr[b + 2] - fr[a + 2]) * k);
    this.sprite.setVisible(show && f < n + 20); // lingers a second at the finish, then vanishes
    if (!show || !racing) return null;

    // How long the ghost took to reach the point you're at now.
    while (this.idx < n - 1 && fr[this.idx * GHOST_STRIDE + 3] < progress) this.idx++;
    const hi = this.idx;
    if (hi === 0 || fr[hi * GHOST_STRIDE + 3] < progress) return null;
    const p0 = fr[(hi - 1) * GHOST_STRIDE + 3];
    const p1 = fr[hi * GHOST_STRIDE + 3];
    const ghostTime = (hi - 1 + (p1 === p0 ? 0 : (progress - p0) / (p1 - p0))) * GHOST_DT;
    return raceTime - ghostTime;
  }

  destroy(): void {
    this.sprite.destroy();
  }
}
