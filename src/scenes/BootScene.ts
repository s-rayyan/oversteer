import Phaser from 'phaser';
import { CARS } from '../game/cars';
import { SceneKey } from '../game/config';

interface GroundPalette { base: number; light: number; dark: number }

const GROUND: Record<string, GroundPalette> = {
  grass: { base: 0x2d6a4f, light: 0x40916c, dark: 0x245c43 },
  desert: { base: 0xd4a762, light: 0xe3bb7e, dark: 0xbf9150 },
  snow: { base: 0xe8f1f5, light: 0xffffff, dark: 0xc9dde6 },
  night: { base: 0x1b3a2f, light: 0x25503f, dark: 0x142b23 },
};

/** Generates pixel-art textures in code so the game runs with zero asset files. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create(): void {
    const g = this.add.graphics();
    const rect = (c: number, x: number, y: number, w: number, h: number) => g.fillStyle(c).fillRect(x, y, w, h);
    const bake = (key: string, w: number, h: number) => { g.generateTexture(key, w, h); g.clear(); };

    // One car texture per model, facing +x. Size and stripe colour vary per car.
    for (const c of CARS) {
      const [w, h] = c.size ?? [16, 9];
      const body = Phaser.Display.Color.IntegerToColor(c.color);
      const wheelW = Math.max(2, Math.round(w * 0.19));
      for (const wx of [Math.round(w * 0.12), Math.round(w * 0.68)]) {
        rect(0x14121f, wx, 0, wheelW, 1); rect(0x14121f, wx, h - 1, wheelW, 1); // wheels
      }
      rect(body.clone().darken(40).color, 1, 1, w - 2, h - 2); // body outline
      rect(c.color, 2, 2, w - 4, h - 4); // body
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
      bake(`car-${c.id}`, w, h);
      rect(0x000000, 2, 1, w - 4, h - 2); rect(0x000000, 1, 2, w - 2, h - 4); // rounded shadow
      bake(`car-${c.id}-shadow`, w, h);
    }
    // Police cruiser (17x9, facing +x) in two frames so the light bar can flash red/blue.
    const cruiser = (key: string, left: number, right: number) => {
      const [w, h] = [17, 9];
      rect(0x14121f, 2, 0, 3, 1); rect(0x14121f, 2, h - 1, 3, 1); rect(0x14121f, 11, 0, 3, 1); rect(0x14121f, 11, h - 1, 3, 1); // wheels
      rect(0x8d99ae, 1, 1, w - 2, h - 2); // body outline
      rect(0xf1faee, 2, 2, w - 4, h - 4); // body
      rect(0x14121f, 2, 2, 5, h - 4); rect(0x14121f, 11, 2, 4, h - 4); // black doors and trunk
      rect(0x1d3557, 9, 2, 2, h - 4); rect(0x1d3557, 6, 2, 2, h - 4); // windows
      rect(left, 7, 2, 2, 2); rect(right, 7, h - 4, 2, 2); // light bar
      rect(0xffd166, w - 2, 2, 1, 1); rect(0xffd166, w - 2, h - 3, 1, 1); // headlights
      rect(0xff6b6b, 1, 2, 1, 1); rect(0xff6b6b, 1, h - 3, 1, 1); // tail lights
      bake(key, w, h);
    };
    cruiser('police-a', 0xe63946, 0x4895ef);
    cruiser('police-b', 0x4895ef, 0xe63946);
    rect(0x000000, 2, 1, 13, 7); rect(0x000000, 1, 2, 15, 5); bake('police-shadow', 17, 9);

    // Coin 7x7.
    rect(0x9c6a00, 1, 0, 5, 7); rect(0x9c6a00, 0, 1, 7, 5);
    rect(0xffd166, 1, 1, 5, 5); rect(0xfff1b8, 2, 2, 1, 2);
    bake('coin', 7, 7);

    // Ground tiles (32x32) per theme.
    for (const [theme, p] of Object.entries(GROUND)) {
      rect(p.base, 0, 0, 32, 32);
      [[3, 4], [20, 9], [11, 22], [27, 26], [6, 14], [16, 2]].forEach(([x, y]) => rect(p.light, x, y, 2, 2));
      [[8, 8], [24, 18], [14, 28], [29, 5], [2, 24]].forEach(([x, y]) => rect(p.dark, x, y, 2, 1));
      bake(`ground-${theme}`, 32, 32);
      // Soft patches scattered over the ground to hide the tile repeat.
      g.fillStyle(p.dark, 0.35).fillRect(2, 0, 10, 1).fillRect(0, 1, 14, 3).fillRect(2, 4, 10, 1);
      g.fillStyle(p.light, 0.4).fillRect(4, 1, 5, 1).fillRect(3, 2, 3, 1);
      bake(`patch-${theme}`, 14, 5);
    }

    // Scenery per theme (all ~16px wide, drawn bottom-anchored).
    const tree = (key: string, shadow: number, trunk: number, dark: number, mid: number, light: number) => {
      rect(shadow, 3, 15, 10, 2);
      rect(trunk, 7, 11, 2, 5);
      rect(dark, 3, 2, 10, 9); rect(dark, 1, 4, 14, 5); rect(dark, 5, 0, 6, 2);
      rect(mid, 4, 2, 6, 6); rect(mid, 2, 5, 3, 3);
      rect(light, 5, 3, 3, 2);
      bake(key, 16, 18);
    };
    tree('deco-grass', 0x1b4332, 0x6b4226, 0x1f5a3d, 0x2d8a5a, 0x52b788);
    tree('deco-night', 0x0e1f19, 0x3b2616, 0x143d2b, 0x1d5a40, 0x2f7d5b);

    // A second look for every theme: a low bush (-b) and a rock (-c), so the scenery isn't all one sprite.
    const bush = (key: string, shadow: number, dark: number, mid: number, light: number) => {
      rect(shadow, 2, 9, 9, 1);
      rect(dark, 2, 4, 9, 5); rect(dark, 4, 2, 5, 2);
      rect(mid, 3, 4, 6, 4); rect(mid, 5, 3, 3, 1);
      rect(light, 4, 4, 2, 1);
      bake(key, 13, 10);
    };
    const rock = (key: string, shadow: number, dark: number, mid: number, light: number) => {
      rect(shadow, 1, 6, 9, 1);
      rect(dark, 1, 3, 8, 3); rect(dark, 3, 1, 4, 2);
      rect(mid, 2, 3, 6, 2); rect(mid, 3, 2, 3, 1);
      rect(light, 3, 2, 2, 1);
      bake(key, 11, 7);
    };
    bush('deco-grass-b', 0x1b4332, 0x1f5a3d, 0x2d8a5a, 0x52b788);
    bush('deco-night-b', 0x0e1f19, 0x143d2b, 0x1d5a40, 0x2f7d5b);
    bush('deco-desert-b', 0xbf9150, 0x7a5a2b, 0x9c7a3f, 0xc9a45c);
    bush('deco-snow-b', 0xc9dde6, 0x2f6b4d, 0xdcebf1, 0xffffff);
    rock('deco-grass-c', 0x1b4332, 0x5c6470, 0x868e99, 0xb4bbc4);
    rock('deco-night-c', 0x0e1f19, 0x2c323d, 0x454d5a, 0x6a7482);
    rock('deco-desert-c', 0xbf9150, 0x8c5e2b, 0xa8743a, 0xc99a5e);
    rock('deco-snow-c', 0xb4ccd8, 0x7d8a96, 0xaeb9c3, 0xffffff);

    // Cactus.
    rect(0xbf9150, 4, 16, 9, 2);
    rect(0x2d8a4e, 6, 4, 4, 13);
    rect(0x2d8a4e, 2, 7, 4, 2); rect(0x2d8a4e, 2, 5, 2, 4);
    rect(0x2d8a4e, 10, 9, 4, 2); rect(0x2d8a4e, 12, 6, 2, 5);
    rect(0x52b788, 7, 4, 1, 13);
    bake('deco-desert', 16, 18);

    // Snowy pine.
    rect(0xc9dde6, 4, 17, 9, 2);
    rect(0x5a3a22, 7, 15, 2, 4);
    for (let y = 0; y < 14; y++) {
      const w = 2 + Math.floor(y / 2) * 2;
      rect(y % 5 < 2 ? 0xf1faee : 0x1f5a3d, 8 - w / 2, y + 1, w, 1);
    }
    bake('deco-snow', 16, 19);

    rect(0xffffff, 0, 0, 2, 2); bake('smoke', 2, 2);
    rect(0xffffff, 0, 0, 1, 1); bake('px', 1, 1); // one white pixel, tinted for flowers
    // Particle shapes: a round puff (smoke), a speck (dust) and a diamond spark (boost flame / sparks).
    rect(0xffffff, 1, 0, 3, 5); rect(0xffffff, 0, 1, 5, 3); bake('puff', 5, 5);
    rect(0xffffff, 0, 0, 2, 1); rect(0xffffff, 0, 1, 1, 1); bake('speck', 2, 2);
    rect(0xffffff, 1, 0, 1, 3); rect(0xffffff, 0, 1, 3, 1); bake('spark', 3, 3);
    // Screen vignette: clear in the middle, dark at the corners.
    const vig = this.textures.createCanvas('vignette', 320, 180)!;
    const ctx = vig.getContext();
    const grad = ctx.createRadialGradient(160, 90, 55, 160, 90, 200);
    grad.addColorStop(0, 'rgba(10,8,20,0)');
    grad.addColorStop(1, 'rgba(10,8,20,0.8)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 320, 180);
    vig.refresh();
    g.destroy();

    this.scene.start(SceneKey.Title);
  }
}
