import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config';

export interface OverlayEntry {
  label: string;
  action: () => void;
}

/** Centered modal panel with a keyboard/mouse-driven list of actions. */
export class Overlay {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private labels: Phaser.GameObjects.Text[] = [];
  private entries: OverlayEntry[] = [];
  private sel = 0;
  visible = false;

  get selected(): number {
    return this.sel;
  }

  constructor(private readonly scene: Phaser.Scene) {}

  show(title: string, lines: string[], entries: OverlayEntry[], selected = 0): void {
    this.hide();
    this.visible = true;
    this.entries = entries;
    this.sel = selected;

    const s = this.scene;
    const w = 200;
    const h = 34 + lines.length * 10 + (lines.length ? 8 : 0) + entries.length * 16 + 6;
    const cx = GAME_WIDTH / 2;
    const top = Math.round((GAME_HEIGHT - h) / 2);
    const base = { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' };
    const add = <T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth>(o: T): T => {
      o.setScrollFactor(0).setDepth(200);
      this.objs.push(o);
      return o;
    };

    add(s.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0b0a14, 0.7).setOrigin(0).setInteractive());
    add(s.add.rectangle(cx, top + h / 2, w, h, 0x1d1b2e).setStrokeStyle(2, 0xffd166));
    add(s.add.text(cx, top + 14, title, { ...base, fontSize: '12px', color: '#ffd166' }).setOrigin(0.5));

    let y = top + 32;
    for (const line of lines) {
      add(s.add.text(cx, y, line, { ...base, fontSize: '8px', color: '#c9d1e3' }).setOrigin(0.5));
      y += 10;
    }
    if (lines.length) y += 8;

    this.labels = entries.map((e, i) => {
      const t = add(
        s.add
          .text(cx, y + i * 16 + 6, e.label, base)
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true })
          .on('pointerover', () => this.select(i))
          .on('pointerdown', () => e.action()),
      );
      return t;
    });
    this.refresh();
  }

  hide(): void {
    this.objs.forEach((o) => o.destroy());
    this.objs = [];
    this.labels = [];
    this.visible = false;
  }

  move(d: number): void {
    this.select((this.sel + d + this.entries.length) % this.entries.length);
  }

  activate(): void {
    this.entries[this.sel]?.action();
  }

  private select(i: number): void {
    this.sel = i;
    this.refresh();
  }

  private refresh(): void {
    this.labels.forEach((t, i) => {
      const on = i === this.sel;
      t.setColor(on ? '#ffd166' : '#ffffff').setText((on ? '> ' : '  ') + this.entries[i].label);
    });
  }
}

/** Coin icon + amount, anchored left or right at (x, y). */
export class CoinBadge {
  private readonly icon: Phaser.GameObjects.Image;
  private readonly text: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, private readonly x: number, y: number, private readonly right = false) {
    this.text = scene.add.text(x, y, '', { fontFamily: 'monospace', fontSize: '8px', color: '#ffd166' }).setOrigin(right ? 1 : 0, 0);
    this.icon = scene.add.image(x, y + 4, 'coin').setOrigin(right ? 1 : 0, 0.5);
  }

  set(n: number): void {
    this.text.setText(String(n));
    if (this.right) {
      this.text.x = this.x;
      this.icon.x = this.x - this.text.width - 3;
    } else {
      this.icon.x = this.x;
      this.text.x = this.x + 10;
    }
  }
}
