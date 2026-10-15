import Phaser from 'phaser';
import {
  CARS, CAR_CLASSES, MAX_LEVEL, UPGRADES, UPGRADE_KEYS, effectiveStats, noUpgrades, statBars, type UpgradeKey,
} from '../game/cars';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { buyCar, buyUpgrade, getCoins, getLevels, owns, selectCar, selectedCar, upgradeCost } from '../game/profile';
import { TRACK_BEST } from '../game/trackBest';
import { TRACKS } from '../game/tracks';
import { CoinBadge } from '../game/ui';

const BAR = { x: 176, w: 64, h: 4 };
const VISIBLE = 6; // car rows shown at once; the list scrolls

export class GarageScene extends Phaser.Scene {
  private sel = 0;
  private top = 0; // first visible car
  private more!: Phaser.GameObjects.Text;
  private rows: Array<{ name: Phaser.GameObjects.Text; tag: Phaser.GameObjects.Text }> = [];
  private coins!: CoinBadge;
  private preview!: Phaser.GameObjects.Image;
  private title!: Phaser.GameObjects.Text;
  private blurb!: Phaser.GameObjects.Text;
  private classTag!: Phaser.GameObjects.Text;
  private classBlurb!: Phaser.GameObjects.Text;
  private bars!: Phaser.GameObjects.Graphics;
  private barLabels: Phaser.GameObjects.Text[] = [];
  private upRows: Phaser.GameObjects.Text[] = [];
  private action!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.Garage);
  }

  create(): void {
    this.sel = Math.max(0, CARS.findIndex((c) => c.id === selectedCar().id));
    this.top = Math.max(0, Math.min(this.sel - 2, CARS.length - VISIBLE));
    this.rows = [];
    this.barLabels = [];
    this.upRows = [];
    const mono = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff' };

    this.add.text(8, 6, 'GARAGE', { ...mono, fontSize: '12px', color: '#ffd166' });
    this.coins = new CoinBadge(this, GAME_WIDTH - 8, 8, true);

    for (let i = 0; i < VISIBLE; i++) {
      const y = 26 + i * 17;
      const name = this.add.text(10, y, '', { ...mono, fontSize: '10px' })
        .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.pick(this.top + i));
      const tag = this.add.text(136, y + 2, '', mono).setOrigin(1, 0);
      this.rows.push({ name, tag });
    }
    this.more = this.add.text(10, 26 + VISIBLE * 17, '', { ...mono, color: '#8d99ae' });

    this.add.rectangle(140, 22, 1, 130, 0x3d405b).setOrigin(0);
    this.preview = this.add.image(166, 36, 'car-hatch').setScale(3);
    this.title = this.add.text(190, 24, '', { ...mono, fontSize: '10px', color: '#ffd166' });
    this.classTag = this.add.text(GAME_WIDTH - 4, 26, '', mono).setOrigin(1, 0);
    this.classBlurb = this.add.text(10, 142, '', { ...mono, fontSize: '7px', wordWrap: { width: 126 } });
    this.blurb = this.add.text(190, 36, '', { ...mono, color: '#8d99ae', wordWrap: { width: 124 } });

    this.bars = this.add.graphics();
    for (let i = 0; i < 5; i++) this.barLabels.push(this.add.text(146, 62 + i * 8, '', { ...mono, fontSize: '7px', color: '#c9d1e3' }));

    UPGRADE_KEYS.forEach((k, i) => {
      this.upRows.push(
        this.add.text(146, 108 + i * 11, '', mono).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.upgrade(k)),
      );
    });

    this.action = this.add.text(226, 146, '', { ...mono, fontSize: '10px' }).setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.activate());
    this.toast = this.add.text(GAME_WIDTH - 4, GAME_HEIGHT - 18, '', { ...mono, color: '#e63946' }).setOrigin(1, 0.5);

    this.add.text(GAME_WIDTH - 4, GAME_HEIGHT - 8, 'ENTER buy/equip   1-3 upgrade', { ...mono, color: '#8d99ae' }).setOrigin(1, 0.5);
    this.add.text(4, GAME_HEIGHT - 8, '< BACK', { ...mono, color: '#ffd166' }).setOrigin(0, 0.5)
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.back());

    const kb = this.input.keyboard!;
    kb.on('keydown-UP', () => this.pick(this.sel - 1));
    kb.on('keydown-DOWN', () => this.pick(this.sel + 1));
    kb.on('keydown-W', () => this.pick(this.sel - 1));
    kb.on('keydown-S', () => this.pick(this.sel + 1));
    kb.on('keydown-ENTER', () => this.activate());
    kb.on('keydown-ESC', () => this.back());
    kb.on('keydown-ONE', () => this.upgrade('engine'));
    kb.on('keydown-TWO', () => this.upgrade('tires'));
    kb.on('keydown-THREE', () => this.upgrade('turbo'));
    this.events.once('shutdown', () => kb.removeAllListeners());

    this.refresh();
  }

  private back(): void {
    this.scene.start(SceneKey.Menu);
  }

  private pick(i: number): void {
    this.sel = (i + CARS.length) % CARS.length;
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + VISIBLE) this.top = this.sel - VISIBLE + 1;
    this.toast.setText('');
    this.refresh();
  }

  private say(msg: string): void {
    this.toast.setText(msg);
  }

  private activate(): void {
    const car = CARS[this.sel];
    if (owns(car.id)) {
      selectCar(car.id);
    } else if (!buyCar(car.id)) {
      this.say(`Need ${car.price - getCoins()} more coins`);
      return;
    } else {
      this.say('');
    }
    this.refresh();
  }

  private upgrade(key: UpgradeKey): void {
    const car = CARS[this.sel];
    if (!owns(car.id)) return this.say('Buy the car first');
    if (upgradeCost(car.id, key) === null) return this.say('Already maxed');
    if (!buyUpgrade(car.id, key)) return this.say('Not enough coins');
    this.say('');
    this.refresh();
  }

  private refresh(): void {
    this.coins.set(getCoins());
    const equipped = selectedCar().id;

    this.more.setText(`${this.sel + 1}/${CARS.length}   ${this.top > 0 ? '^' : ' '} ${this.top + VISIBLE < CARS.length ? 'v' : ' '}`);
    this.rows.forEach((r, i) => {
      const c = CARS[this.top + i];
      const on = this.top + i === this.sel;
      r.name.setText((on ? '> ' : '  ') + c.name).setColor(on ? '#ffd166' : '#ffffff');
      if (c.id === equipped) r.tag.setText('EQUIPPED').setColor('#52b788');
      else if (owns(c.id)) r.tag.setText('OWNED').setColor('#8d99ae');
      else r.tag.setText(`$${c.price}`).setColor(getCoins() >= c.price ? '#ffd166' : '#e63946');
    });

    const car = CARS[this.sel];
    const lv = owns(car.id) ? getLevels(car.id) : noUpgrades();
    this.preview.setTexture(`car-${car.id}`);
    this.title.setText(car.name);
    this.blurb.setText(car.blurb);
    const cls = CAR_CLASSES[car.carClass];
    this.classTag.setText(cls.label).setColor(cls.color);
    const wins = TRACKS.filter((t) => TRACK_BEST[t.id]?.best === car.carClass);
    const fastest = wins.length === 0 ? '' : wins.length === 1 ? `Fastest on: ${wins[0].name}` : wins.length === 2 ? `Fastest on: ${wins[0].name}, ${wins[1].name}` : `Fastest on ${wins.length} tracks`;
    this.classBlurb.setText(`${cls.blurb}\n${fastest}`).setColor(cls.color);

    this.bars.clear();
    const base = statBars(car.stats);
    statBars(effectiveStats(car, lv)).forEach(([label, v], i) => {
      const y = 62 + i * 8;
      this.barLabels[i].setText(label);
      this.bars.fillStyle(0x1d1b2e).fillRect(BAR.x, y + 1, BAR.w, BAR.h);
      this.bars.fillStyle(0x3d405b).fillRect(BAR.x, y + 1, Math.round(BAR.w * base[i][1]), BAR.h); // stock
      this.bars.fillStyle(0xffd166).fillRect(BAR.x + Math.round(BAR.w * base[i][1]), y + 1, Math.round(BAR.w * (v - base[i][1])), BAR.h); // upgrades
    });

    UPGRADE_KEYS.forEach((k, i) => {
      const u = UPGRADES[k];
      const cost = upgradeCost(car.id, k);
      const pips = '#'.repeat(lv[k]) + '-'.repeat(MAX_LEVEL - lv[k]);
      let right = 'MAX';
      let color = '#52b788';
      if (cost !== null) {
        right = `$${cost}`;
        color = !owns(car.id) ? '#555a73' : getCoins() >= cost ? '#ffd166' : '#e63946';
      }
      this.upRows[i].setText(`[${i + 1}] ${u.name.padEnd(7)} ${pips}  ${right}`).setColor(color);
    });

    if (car.id === equipped) this.action.setText('EQUIPPED').setColor('#52b788');
    else if (owns(car.id)) this.action.setText('ENTER: EQUIP').setColor('#ffffff');
    else this.action.setText(`ENTER: BUY $${car.price}`).setColor(getCoins() >= car.price ? '#ffd166' : '#e63946');
  }
}
