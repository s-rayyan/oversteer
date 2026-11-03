import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { lastDim, setDim, type Dim } from '../game/dimension';
import { selectedCar } from '../game/profile';
import { ensure3D } from '../three/load';

const CARD = { y: 46, w: 128, h: 104, gap: 16 };
const ART_H = 66;

interface Card {
  dim: Dim;
  x: number;
  frame: Phaser.GameObjects.Rectangle;
  title: Phaser.GameObjects.Text;
}

/**
 * The first screen: pick the classic top-down 2D game or the 3D one. Both share the cars, coins and garage; each
 * keeps its own records, ghosts and leaderboards. The last pick is highlighted to start with.
 */
export class ModeSelectScene extends Phaser.Scene {
  private cards: Card[] = [];
  private sel = 0;
  private t = 0;
  private leaving = false;
  private road3d!: Phaser.GameObjects.Graphics;
  private car2d!: Phaser.GameObjects.Image;
  private carColor = 0xe63946;

  constructor() {
    super(SceneKey.ModeSelect);
  }

  create(): void {
    this.t = 0;
    this.leaving = false;
    this.cards = [];
    const mono = { fontFamily: 'monospace', color: '#ffffff' };
    this.add.text(GAME_WIDTH / 2, 16, 'OVERSTEER', { ...mono, fontSize: '20px', color: '#ffd166' }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 33, 'CHOOSE YOUR GAME', { ...mono, fontSize: '8px', color: '#8d99ae' }).setOrigin(0.5);

    const def = selectedCar();
    this.carColor = def.color;
    const left = (GAME_WIDTH - CARD.w * 2 - CARD.gap) / 2;
    const specs: Array<[Dim, string, string]> = [
      ['2d', '2D  CLASSIC', 'top-down drifting'],
      ['3d', '3D  NEW!', 'chase-cam racing'],
    ];
    specs.forEach(([dim, title, sub], i) => {
      const x = left + i * (CARD.w + CARD.gap);
      this.add.rectangle(x, CARD.y, CARD.w, CARD.h, 0x1d1b2e).setOrigin(0);
      if (dim === '2d') this.build2DArt(x + 4, CARD.y + 4, def.id);
      else this.road3d = this.add.graphics();
      const t = this.add.text(x + CARD.w / 2, CARD.y + ART_H + 12, title, { ...mono, fontSize: '12px' }).setOrigin(0.5);
      this.add.text(x + CARD.w / 2, CARD.y + ART_H + 26, sub, { ...mono, fontSize: '8px', color: '#c9d1e3' }).setOrigin(0.5);
      const frame = this.add.rectangle(x, CARD.y, CARD.w, CARD.h).setOrigin(0).setStrokeStyle(1, 0x3d405b)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.select(i))
        .on('pointerdown', () => { this.select(i); this.pick(); });
      this.cards.push({ dim, x, frame, title: t });
    });

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 20, 'Same cars, coins and garage. Own records and leaderboards.', { ...mono, fontSize: '7px', color: '#8d99ae' }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 8, 'LEFT/RIGHT choose     ENTER play', { ...mono, fontSize: '8px', color: '#8d99ae' }).setOrigin(0.5);

    this.select(lastDim() === '3d' ? 1 : 0);
    const kb = this.input.keyboard!;
    for (const k of ['LEFT', 'A']) kb.on(`keydown-${k}`, () => this.select(0));
    for (const k of ['RIGHT', 'D']) kb.on(`keydown-${k}`, () => this.select(1));
    kb.on('keydown-TAB', (e: KeyboardEvent) => { e.preventDefault(); this.select(1 - this.sel); });
    kb.on('keydown-TWO', () => { this.select(0); this.pick(); });
    kb.on('keydown-THREE', () => { this.select(1); this.pick(); });
    kb.on('keydown-ENTER', () => this.pick());
    kb.on('keydown-SPACE', () => this.pick());
    this.events.once('shutdown', () => kb.removeAllListeners());
    this.cameras.main.fadeIn(250, 20, 18, 31);
  }

  /** A little top-down track with the car going round, like the 2D game itself. */
  private build2DArt(x: number, y: number, carId: string): void {
    const w = CARD.w - 8;
    this.add.tileSprite(x, y, w, ART_H, 'ground-grass').setOrigin(0);
    const g = this.add.graphics();
    const cx = x + w / 2, cy = y + ART_H / 2;
    g.lineStyle(15, 0xf1faee).strokeEllipse(cx, cy, w - 22, ART_H - 18);
    g.lineStyle(13, 0xe63946).strokeEllipse(cx, cy, w - 22, ART_H - 18);
    g.lineStyle(11, 0x3d405b).strokeEllipse(cx, cy, w - 22, ART_H - 18);
    g.fillStyle(0x2d6a4f).fillEllipse(cx, cy, w - 44, ART_H - 40);
    this.add.image(cx - 30, cy - 6, 'deco-grass').setOrigin(0.5, 0.9);
    this.add.image(cx + 26, cy + 4, 'deco-grass-b').setOrigin(0.5, 0.9);
    this.car2d = this.add.image(0, 0, `car-${carId}`);
  }

  /** A road running to the horizon in perspective, with the car seen from behind. Redrawn every frame. */
  private draw3DArt(): void {
    const g = this.road3d;
    const card = this.cards[1];
    if (!g || !card) return;
    const x = card.x + 4;
    const y = CARD.y + 4;
    const w = CARD.w - 8;
    const cx = x + w / 2;
    const hy = y + 24; // horizon
    const by = y + ART_H;
    const H = by - hy;
    g.clear();
    g.fillGradientStyle(0x3f8fd8, 0x3f8fd8, 0xcfe8f5, 0xcfe8f5, 1).fillRect(x, y, w, hy - y);
    // mountains on the horizon
    g.fillStyle(0x4f7d5e);
    g.fillTriangle(x, hy, x + 26, hy - 12, x + 50, hy);
    g.fillTriangle(x + 38, hy, x + 66, hy - 17, x + 92, hy);
    g.fillTriangle(x + 80, hy, x + 102, hy - 10, x + w, hy);
    g.fillStyle(0x2d6a4f).fillRect(x, hy, w, H);
    const halfAt = (yy: number) => 2 + ((yy - hy) / H) * 54;
    g.fillStyle(0x3d405b).fillPoints([{ x: cx - 2, y: hy }, { x: cx + 2, y: hy }, { x: cx + halfAt(by), y: by }, { x: cx - halfAt(by), y: by }], true);
    // kerb stripes and centre dashes, scrolling towards you
    const phase = (this.t * 2.2) % 2;
    for (let k = 0; k < 26; k++) {
      const z0 = 1 + (k - phase) * 0.55;
      const z1 = z0 + 0.55;
      if (z0 < 0.95) continue;
      const y0 = hy + H / z1, y1 = Math.min(by, hy + H / z0);
      const h0 = halfAt(y0), h1 = halfAt(y1);
      const red = (k % 2) === 0;
      g.fillStyle(red ? 0xe63946 : 0xf1faee);
      for (const s of [-1, 1]) {
        g.fillPoints([{ x: cx + s * h0, y: y0 }, { x: cx + s * h0 * 1.14, y: y0 }, { x: cx + s * h1 * 1.14, y: y1 }, { x: cx + s * h1, y: y1 }], true);
      }
      if (red) g.fillStyle(0xe9c46a).fillPoints([{ x: cx - h0 * 0.04, y: y0 }, { x: cx + h0 * 0.04, y: y0 }, { x: cx + h1 * 0.04, y: y1 }, { x: cx - h1 * 0.04, y: y1 }], true);
    }
    // the car from behind
    const sway = Math.sin(this.t * 1.7) * 6;
    const carX = Math.round(cx + sway);
    const carY = by - 6;
    const body = Phaser.Display.Color.IntegerToColor(this.carColor);
    g.fillStyle(0x000000, 0.3).fillRect(carX - 19, carY + 3, 38, 3);
    g.fillStyle(0x14121f).fillRect(carX - 18, carY - 3, 7, 7).fillRect(carX + 11, carY - 3, 7, 7);
    g.fillStyle(body.clone().darken(30).color).fillRect(carX - 17, carY - 10, 34, 10);
    g.fillStyle(this.carColor).fillRect(carX - 16, carY - 11, 32, 8);
    g.fillStyle(0x1d3557).fillRect(carX - 10, carY - 18, 20, 7);
    g.fillStyle(this.carColor).fillRect(carX - 11, carY - 19, 22, 2);
    g.fillStyle(0xff3b4a).fillRect(carX - 15, carY - 9, 6, 2).fillRect(carX + 9, carY - 9, 6, 2);
    g.fillStyle(0xffffff).fillRect(carX - 1, carY - 11, 2, 8);
  }

  private select(i: number): void {
    this.sel = i;
    this.cards.forEach((c, k) => {
      const on = k === i;
      c.frame.setStrokeStyle(on ? 2 : 1, on ? 0xffd166 : 0x3d405b);
      c.title.setColor(on ? '#ffd166' : '#ffffff');
    });
  }

  private pick(): void {
    if (this.leaving) return;
    this.leaving = true;
    const dim = this.cards[this.sel].dim;
    setDim(dim);
    if (dim === '3d') void ensure3D(this.game).catch(() => undefined); // start downloading the 3D engine now
    this.cameras.main.fadeOut(200, 20, 18, 31);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(SceneKey.Title));
  }

  update(_time: number, delta: number): void {
    this.t += delta / 1000;
    if (this.car2d) {
      const card = this.cards[0];
      const w = CARD.w - 8;
      const cx = card.x + 4 + w / 2, cy = CARD.y + 4 + ART_H / 2;
      const rx = (w - 22) / 2, ry = (ART_H - 18) / 2;
      const a = this.t * 1.3;
      this.car2d.setPosition(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry).setRotation(Math.atan2(Math.cos(a) * ry, -Math.sin(a) * rx) + 0.35);
    }
    this.draw3DArt();
  }
}
