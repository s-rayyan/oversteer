import Phaser from 'phaser';
import { bakeCar, paintedKey } from '../game/carTexture';
import { PAINTS, SMOKES, type Paint, type SmokeStyle } from '../game/cosmetics';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { buyStyle, equippedStyle, getCoins, ownsStyle, selectedCar, type StyleKind } from '../game/profile';
import { CoinBadge } from '../game/ui';

const COLS: Array<{ kind: StyleKind; title: string; x: number; items: ReadonlyArray<Paint | SmokeStyle> }> = [
  { kind: 'paint', title: 'PAINT', x: 10, items: PAINTS },
  { kind: 'smoke', title: 'TYRE SMOKE', x: 172, items: SMOKES },
];
const TOP = 70;
const ROW_H = 10;

/** The paint shop: spend coins on car paint and tyre-smoke colours. They change looks only, never the stats. */
export class StyleScene extends Phaser.Scene {
  private col = 0;
  private row = [0, 0];
  private labels: Phaser.GameObjects.Text[][] = [[], []];
  private tags: Phaser.GameObjects.Text[][] = [[], []];
  private coins!: CoinBadge;
  private preview!: Phaser.GameObjects.Image;
  private smokeGfx!: Phaser.GameObjects.Graphics;
  private toast!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.Style);
  }

  create(): void {
    this.col = 0;
    this.labels = [[], []];
    this.tags = [[], []];
    this.row = COLS.map((c) => Math.max(0, c.items.findIndex((i) => i.id === equippedStyle(c.kind))));
    const mono = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' };

    this.add.text(8, 6, 'PAINT SHOP', { ...mono, fontSize: '12px', color: '#ffd166' });
    this.coins = new CoinBadge(this, GAME_WIDTH - 8, 8, true);
    this.add.text(GAME_WIDTH / 2, 18, selectedCar().name.toUpperCase(), { ...mono, color: '#8d99ae' }).setOrigin(0.5, 0);
    this.smokeGfx = this.add.graphics();
    this.preview = this.add.image(GAME_WIDTH / 2 + 20, 44, `car-${selectedCar().id}`).setScale(4);

    COLS.forEach((c, ci) => {
      this.add.text(c.x, TOP - 12, c.title, { ...mono, color: '#ffd166' });
      c.items.forEach((_, ri) => {
        const y = TOP + ri * ROW_H;
        this.labels[ci].push(this.add.text(c.x, y, '', mono).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.click(ci, ri)));
        this.tags[ci].push(this.add.text(c.x + 140, y, '', mono).setOrigin(1, 0));
      });
    });

    this.toast = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 17, '', { ...mono, color: '#e63946' }).setOrigin(0.5, 0);
    this.add.text(4, GAME_HEIGHT - 8, '< BACK', { ...mono, color: '#ffd166' }).setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.back());
    this.add.text(GAME_WIDTH - 4, GAME_HEIGHT - 8, 'ARROWS select   ENTER buy/equip   ESC back', { ...mono, color: '#8d99ae' }).setOrigin(1, 0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.moveCol(-1));
    kb.on('keydown-RIGHT', () => this.moveCol(1));
    kb.on('keydown-A', () => this.moveCol(-1));
    kb.on('keydown-D', () => this.moveCol(1));
    kb.on('keydown-UP', () => this.moveRow(-1));
    kb.on('keydown-DOWN', () => this.moveRow(1));
    kb.on('keydown-W', () => this.moveRow(-1));
    kb.on('keydown-S', () => this.moveRow(1));
    kb.on('keydown-ENTER', () => this.activate());
    kb.on('keydown-ESC', () => this.back());
    this.events.once('shutdown', () => kb.removeAllListeners());
    this.refresh();
  }

  private back(): void {
    this.scene.start(SceneKey.Garage);
  }

  private moveCol(d: number): void {
    this.col = (this.col + d + COLS.length) % COLS.length;
    this.toast.setText('');
    this.refresh();
  }

  private moveRow(d: number): void {
    const n = COLS[this.col].items.length;
    this.row[this.col] = (this.row[this.col] + d + n) % n;
    this.toast.setText('');
    this.refresh();
  }

  private click(ci: number, ri: number): void {
    const same = this.col === ci && this.row[ci] === ri;
    this.col = ci;
    this.row[ci] = ri;
    if (same) this.activate();
    else {
      this.toast.setText('');
      this.refresh();
    }
  }

  private activate(): void {
    const c = COLS[this.col];
    const item = c.items[this.row[this.col]];
    if (!buyStyle(c.kind, item.id)) this.toast.setText(`Need ${item.price - getCoins()} more coins`);
    else this.toast.setText('');
    this.refresh();
  }

  private refresh(): void {
    this.coins.set(getCoins());
    COLS.forEach((c, ci) => {
      const equipped = equippedStyle(c.kind);
      c.items.forEach((item, ri) => {
        const on = ci === this.col && ri === this.row[ci];
        this.labels[ci][ri].setText((on ? '> ' : '  ') + item.name).setColor(on ? '#ffd166' : '#ffffff');
        const tag = this.tags[ci][ri];
        if (item.id === equipped) tag.setText('EQUIPPED').setColor('#52b788');
        else if (ownsStyle(c.kind, item.id)) tag.setText('OWNED').setColor('#8d99ae');
        else tag.setText(`$${item.price}`).setColor(getCoins() >= item.price ? '#ffd166' : '#e63946');
      });
    });

    // The preview shows whatever is highlighted: a paint on the car, or a smoke trail behind it.
    const car = selectedCar();
    const paint = PAINTS[this.row[0]];
    const smoke = SMOKES[this.col === 1 ? this.row[1] : SMOKES.findIndex((s) => s.id === equippedStyle('smoke'))];
    const key = this.col === 0
      ? (paint.color === null ? `car-${car.id}` : bakeCar(this, car, paint.color, `car-${car.id}-${paint.id}`))
      : paintedKey(this, car);
    this.preview.setTexture(key);
    const tints = Array.isArray(smoke.tint) ? smoke.tint : [smoke.tint];
    this.smokeGfx.clear();
    for (let i = 0; i < 6; i++) {
      this.smokeGfx.fillStyle(tints[i % tints.length], 0.85 - i * 0.12).fillCircle(this.preview.x - 40 - i * 9, 44 + (i % 2 ? 4 : -4), 3 + i * 0.8);
    }
  }
}
