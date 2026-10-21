import Phaser from 'phaser';
import type { CarDef } from './cars';
import { equippedPaint } from './profile';

/** Draws one car (facing +x) into `g` in the given body colour. */
function drawCar(g: Phaser.GameObjects.Graphics, c: CarDef, color: number): [number, number] {
  const rect = (col: number, x: number, y: number, w: number, h: number) => g.fillStyle(col).fillRect(x, y, w, h);
  const [w, h] = c.size ?? [16, 9];
  const body = Phaser.Display.Color.IntegerToColor(color);
  const wheelW = Math.max(2, Math.round(w * 0.19));
  for (const wx of [Math.round(w * 0.12), Math.round(w * 0.68)]) {
    rect(0x14121f, wx, 0, wheelW, 1); rect(0x14121f, wx, h - 1, wheelW, 1); // wheels
  }
  rect(body.clone().darken(40).color, 1, 1, w - 2, h - 2); // body outline
  rect(color, 2, 2, w - 4, h - 4); // body
  rect(body.clone().lighten(25).color, 3, 2, w - 6, 1); // roof highlight
  rect(body.clone().darken(20).color, 3, h - 3, w - 6, 1); // shaded lower panel
  rect(c.stripe ?? 0xffffff, 2, Math.floor(h / 2), w - 4, 1); // racing stripe
  const wsX = Math.round(w * 0.5);
  rect(0x1d3557, wsX, 2, 3, h - 4); // windshield
  rect(0x457b9d, wsX, 2, 1, h - 4);
  rect(0x1d3557, Math.round(w * 0.25), 2, 2, h - 4); // rear window
  rect(body.clone().darken(40).color, wsX, 0, 2, 1); rect(body.clone().darken(40).color, wsX, h - 1, 2, 1); // mirrors
  rect(0xffd166, w - 2, 2, 1, 1); rect(0xffd166, w - 2, h - 3, 1, 1); // headlights
  rect(0xfff1b8, w - 1, 2, 1, 1); rect(0xfff1b8, w - 1, h - 3, 1, 1); // headlight glow
  rect(0xff6b6b, 1, 2, 1, 1); rect(0xff6b6b, 1, h - 3, 1, 1); // tail lights
  if (w >= 17) rect(0x14121f, 0, 2, 1, h - 4); // rear spoiler on the big cars
  else { rect(0x8a2b3a, 0, 2, 1, 1); rect(0x8a2b3a, 0, h - 3, 1, 1); } // tail light glow
  return [w, h];
}

/** Makes the texture `key` for this car in `color` (and nothing if it already exists). Returns the key. */
export function bakeCar(scene: Phaser.Scene, c: CarDef, color: number, key: string): string {
  if (scene.textures.exists(key)) return key;
  const g = scene.add.graphics();
  const [w, h] = drawCar(g, c, color);
  g.generateTexture(key, w, h);
  g.destroy();
  return key;
}

/** The shadow shape for a car (the same whatever the paint). */
export function bakeCarShadow(scene: Phaser.Scene, c: CarDef): void {
  const key = `car-${c.id}-shadow`;
  if (scene.textures.exists(key)) return;
  const [w, h] = c.size ?? [16, 9];
  const g = scene.add.graphics();
  g.fillStyle(0x000000).fillRect(2, 1, w - 4, h - 2).fillRect(1, 2, w - 2, h - 4);
  g.generateTexture(key, w, h);
  g.destroy();
}

/** Texture key for a car in the paint job currently equipped (made on first use). Unowned cars show their own colour. */
export function paintedKey(scene: Phaser.Scene, c: CarDef, owned = true): string {
  const paint = equippedPaint();
  if (!owned || paint.color === null) return `car-${c.id}`;
  return bakeCar(scene, c, paint.color, `car-${c.id}-${paint.id}`);
}
