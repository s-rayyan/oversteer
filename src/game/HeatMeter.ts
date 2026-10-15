export class HeatMeter {
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly x = 308;
  private readonly y = 28;
  private readonly w = 8;
  private readonly h = 100;

  constructor(scene: Phaser.Scene) {
    scene.add
      .rectangle(this.x, this.y, this.w, this.h, 0x14121f, 0.94)
      .setOrigin(0)
      .setStrokeStyle(1, 0x3d405b)
      .setScrollFactor(0)
      .setDepth(100);

    this.bar = scene.add.graphics().setScrollFactor(0).setDepth(101);
  }

  update(heat: number): void {
    this.bar.clear();

    // Clamp heat ratio between 0 and 1
    const clampedHeat = Phaser.Math.Clamp(heat, 0, 1);
    if (clampedHeat <= 0) return;

    // Interpolate directly from Green (0, 255, 0) to Red (255, 0, 0)
    const color = Phaser.Display.Color.Interpolate.RGBWithRGB(
      0, 255, 0,
      255, 0, 0,
      100,
      Math.round(clampedHeat * 100)
    );

    const barWidth = this.w - 2;
    const innerHeight = this.h - 2;
    const barHeight = Math.round(innerHeight * clampedHeat);

    // Render filling from the bottom up
    const barX = this.x + 1;
    const barY = this.y + 1 + (innerHeight - barHeight);

    this.bar.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b));
    this.bar.fillRect(barX, barY, barWidth, barHeight);
  }
}