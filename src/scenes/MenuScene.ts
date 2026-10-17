import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { askName } from '../game/nameDialog';
import { getCoins } from '../game/profile';
import { CoinBadge } from '../game/ui';
import { getName, setName } from '../game/player';
import { BOARD_ENDLESS, BOARD_OVERSTEER, renameEverywhere } from '../net/leaderboard';
import { formatTime, getEndlessBest, getRecord } from '../game/records';
import { GHOST_MODES, GHOST_MODE_LABEL, getGhostMode, setGhostMode } from '../game/ghost';
import { sampleClosedSpline } from '../game/spline';
import { surfaceFlags } from '../game/surfaces';
import { getCar } from '../game/cars';
import { TRACK_BEST } from '../game/trackBest';
import { TRACK_CLASSES, classifyTrack, type TrackClassId } from '../game/trackClass';
import { DIFFICULTY_COLOR, GROUPS, TRACKS } from '../game/tracks';

const ENDLESS_TAB = GROUPS.length;
const OVERSTEER_TAB = GROUPS.length + 1;
const TAB_COUNT = GROUPS.length + 2;
const TAB_W = GAME_WIDTH / TAB_COUNT;
const PREVIEW = { x: 184, y: 62, w: 120, h: 74 };

const classCache = new Map<string, TrackClassId>();
let lastTab = 0;
let lastTrack = 0;

export class MenuScene extends Phaser.Scene {
  private tab = lastTab;
  private row = lastTrack;
  private tabLabels: Phaser.GameObjects.Text[] = [];
  private tabBar!: Phaser.GameObjects.Rectangle;
  private blurb!: Phaser.GameObjects.Text;
  private rows: Array<{ name: Phaser.GameObjects.Text; diff: Phaser.GameObjects.Text }> = [];
  private preview!: Phaser.GameObjects.Graphics;
  private previewText!: Phaser.GameObjects.Text;
  private info!: Phaser.GameObjects.Text;
  private classInfo!: Phaser.GameObjects.Text;
  private typeTag!: Phaser.GameObjects.Text;
  private driver!: Phaser.GameObjects.Text;
  private ghostChip!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.Menu);
  }

  private tracksInTab() {
    return this.tab >= ENDLESS_TAB ? [] : TRACKS.filter((t) => t.group === GROUPS[this.tab].id);
  }

  create(): void {
    this.tab = lastTab;
    this.row = lastTrack;
    this.rows = [];
    const mono = { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' };

    this.add.text(GAME_WIDTH / 2, 14, 'OVERSTEER', { ...mono, fontSize: '18px', color: '#ffd166' }).setOrigin(0.5);

    this.driver = this.add.text(4, 4, '', { ...mono, fontSize: '8px', color: '#8d99ae' })
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => void this.changeName());
    this.updateDriver();
    new CoinBadge(this, 4, 15).set(getCoins());
    this.add.text(GAME_WIDTH - 4, 15, 'GARAGE [G]', { ...mono, fontSize: '8px', color: '#ffd166' })
      .setOrigin(1, 0).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.scene.start(SceneKey.Garage));
    this.add.text(GAME_WIDTH - 4, 4, 'LEADERBOARD [L]', { ...mono, fontSize: '8px', color: '#ffd166' })
      .setOrigin(1, 0).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.openBoard());

    this.tabBar = this.add.rectangle(0, 41, TAB_W, 2, 0xffd166).setOrigin(0, 0);
    this.tabLabels = [...GROUPS.map((g) => g.short), 'ENDLESS', 'OVERSTEER'].map((label, i) =>
      this.add
        .text(TAB_W * i + TAB_W / 2, 33, label, { ...mono, fontSize: '8px' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.setTab(i)),
    );

    this.blurb = this.add.text(20, 48, '', { ...mono, fontSize: '8px', color: '#8d99ae' });

    for (let i = 0; i < 5; i++) {
      const y = 66 + i * 18;
      const name = this.add.text(24, y, '', mono).setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.setRow(i))
        .on('pointerdown', () => { this.setRow(i); this.start(); });
      const diff = this.add.text(170, y + 2, '', { ...mono, fontSize: '8px' }).setOrigin(1, 0);
      this.rows.push({ name, diff });
    }

    // Who you race against on circuits; click it (or press T) to change. Remembered between visits.
    this.ghostChip = this.add.text(24, 152, '', { ...mono, fontSize: '8px', color: '#bfe9ff', backgroundColor: '#1d1b2e', padding: { x: 4, y: 3 } })
      .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.cycleGhost());

    this.add.rectangle(PREVIEW.x, PREVIEW.y, PREVIEW.w, PREVIEW.h, 0x1d1b2e).setOrigin(0).setStrokeStyle(1, 0x3d405b);
    this.preview = this.add.graphics();
    this.previewText = this.add.text(PREVIEW.x + PREVIEW.w / 2, PREVIEW.y + PREVIEW.h / 2, '', { ...mono, fontSize: '8px', align: 'center', color: '#c9d1e3' }).setOrigin(0.5);
    this.info = this.add.text(PREVIEW.x, PREVIEW.y + PREVIEW.h + 5, '', { ...mono, fontSize: '8px', color: '#c9d1e3' });

    this.classInfo = this.add.text(PREVIEW.x, PREVIEW.y + PREVIEW.h + 15, '', { ...mono, fontSize: '7px', color: '#ffd166' });
    // track type, in the corner of the map preview
    this.typeTag = this.add.text(PREVIEW.x + 3, PREVIEW.y + 2, '', { ...mono, fontSize: '7px' });
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 8, 'ARROWS select     ENTER start', { ...mono, fontSize: '8px', color: '#8d99ae' })
      .setOrigin(0.5);

    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.setTab(this.tab - 1));
    kb.on('keydown-RIGHT', () => this.setTab(this.tab + 1));
    kb.on('keydown-A', () => this.setTab(this.tab - 1));
    kb.on('keydown-D', () => this.setTab(this.tab + 1));
    kb.on('keydown-UP', () => this.setRow(this.row - 1));
    kb.on('keydown-DOWN', () => this.setRow(this.row + 1));
    kb.on('keydown-W', () => this.setRow(this.row - 1));
    kb.on('keydown-S', () => this.setRow(this.row + 1));
    kb.on('keydown-ENTER', () => this.start());
    kb.on('keydown-L', () => this.openBoard());
    kb.on('keydown-G', () => this.scene.start(SceneKey.Garage));
    kb.on('keydown-N', () => void this.changeName());
    kb.on('keydown-T', () => this.cycleGhost());
    this.events.once('shutdown', () => kb.removeAllListeners());

    this.refresh();
    if (!getName()) void this.changeName(false);
  }

  private cycleGhost(): void {
    if (this.tab >= ENDLESS_TAB) return;
    setGhostMode(GHOST_MODES[(GHOST_MODES.indexOf(getGhostMode()) + 1) % GHOST_MODES.length]);
    this.refresh();
  }

  private updateDriver(): void {
    this.driver.setText(`DRIVER: ${getName() || '???'} [N]`);
  }

  private async changeName(cancellable = true): Promise<void> {
    const old = getName();
    const name = await askName(old, cancellable);
    if (name === null) return;
    setName(name);
    if (old && name !== old) void renameEverywhere(name); // carry the new name onto the leaderboards
    if (this.driver.active) this.updateDriver();
  }

  private openBoard(): void {
    const id = this.tab === ENDLESS_TAB ? BOARD_ENDLESS : this.tab === OVERSTEER_TAB ? BOARD_OVERSTEER : this.tracksInTab()[this.row].id;
    this.scene.start(SceneKey.Leaderboard, { board: id });
  }

  private setTab(i: number): void {
    this.tab = (i + TAB_COUNT) % TAB_COUNT;
    this.row = 0;
    this.refresh();
  }

  private setRow(i: number): void {
    const n = Math.max(1, this.tracksInTab().length);
    this.row = (i + n) % n;
    this.refresh();
  }

  private start(): void {
    lastTab = this.tab;
    lastTrack = this.row;
    if (this.tab >= ENDLESS_TAB) {
      this.scene.start(this.tab === OVERSTEER_TAB ? SceneKey.Oversteer : SceneKey.Endless, {});
    } else {
      this.scene.start(SceneKey.Race, { trackId: this.tracksInTab()[this.row].id });
    }
  }

  private refresh(): void {
    this.tabLabels.forEach((t, i) => t.setColor(i === this.tab ? '#ffd166' : '#ffffff'));
    this.tabBar.x = TAB_W * this.tab;

    const tracks = this.tracksInTab();
    this.blurb.setText(this.tab === ENDLESS_TAB ? 'A road that never stops.' : this.tab === OVERSTEER_TAB ? 'Auto throttle, auto boost.' : GROUPS[this.tab].blurb);

    this.rows.forEach((r, i) => {
      if (this.tab >= ENDLESS_TAB) {
        const wild = this.tab === OVERSTEER_TAB;
        r.name.setText(i === 0 ? '> Random track' : '').setColor('#ffd166');
        r.diff.setText(i === 0 ? (wild ? 'INSANE' : 'INFINITE') : '').setColor(wild ? '#e63946' : '#ffd166');
        return;
      }
      const t = tracks[i];
      if (!t) { r.name.setText(''); r.diff.setText(''); return; }
      const on = i === this.row;
      r.name.setText((on ? '> ' : '  ') + t.name).setColor(on ? '#ffd166' : '#ffffff');
      r.diff.setText(t.difficulty.toUpperCase()).setColor(DIFFICULTY_COLOR[t.difficulty]);
    });

    this.ghostChip.setText(`GHOST: ${GHOST_MODE_LABEL[getGhostMode()]}`).setVisible(this.tab < ENDLESS_TAB);
    this.preview.clear();
    this.classInfo.setText('');
    this.typeTag.setText('');
    if (this.tab >= ENDLESS_TAB) {
      const wild = this.tab === OVERSTEER_TAB;
      this.previewText.setText(wild
        ? 'OVERSTEER\nAuto throttle and\nauto boost. Drift\nto refill it.\nSteer. Slide.\nSurvive.'
        : 'Random road,\nstopwatch running.\nIt narrows as\nyou go. How far\ncan you get?');
      this.info.setText(`BEST ${getEndlessBest(wild ? 'oversteer' : 'endless')} m`);
      return;
    }

    const t = tracks[this.row];
    this.previewText.setText('');
    const pts = sampleClosedSpline(t.points, 8);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const sc = Math.min((PREVIEW.w - 14) / (Math.max(...xs) - minX), (PREVIEW.h - 14) / (Math.max(...ys) - minY));
    const ox = PREVIEW.x + (PREVIEW.w - (Math.max(...xs) - minX) * sc) / 2;
    const oy = PREVIEW.y + (PREVIEW.h - (Math.max(...ys) - minY) * sc) / 2;
    const mapped = pts.map((p) => new Phaser.Math.Vector2(ox + (p.x - minX) * sc, oy + (p.y - minY) * sc));
    this.preview.lineStyle(3, 0x3d405b).strokePoints(mapped, true);
    this.preview.lineStyle(1, Phaser.Display.Color.HexStringToColor(DIFFICULTY_COLOR[t.difficulty]).color).strokePoints(mapped, true);
    // gravel (brown) and drift zones (blue) over the line; pads as yellow dots
    const flags = surfaceFlags(mapped.length, t);
    for (const [key, color] of [['rough', 0xc9a66b], ['zone', 0x4895ef]] as const) {
      this.preview.lineStyle(2, color);
      let run: Phaser.Math.Vector2[] = [];
      flags.forEach((f, i) => {
        if (f[key]) run.push(mapped[i]);
        else { if (run.length > 1) this.preview.strokePoints(run, false); run = []; }
      });
      if (run.length > 1) this.preview.strokePoints(run, false);
    }
    this.preview.fillStyle(0xffd166);
    flags.forEach((f, i) => { if (f.pad && !flags[(i - 1 + flags.length) % flags.length].pad) this.preview.fillRect(Math.floor(mapped[i].x) - 1, Math.floor(mapped[i].y) - 1, 3, 3); });
    this.preview.fillStyle(0xffffff).fillRect(Math.floor(mapped[0].x) - 1, Math.floor(mapped[0].y) - 1, 3, 3);

    let cid = classCache.get(t.id);
    if (!cid) classCache.set(t.id, (cid = classifyTrack(t)));
    const tc = TRACK_CLASSES[cid];
    this.typeTag.setText(tc.label).setColor(tc.color);
    // fastest car here, and the fastest one you can buy for $1000 or less (from the benchmark)
    const tb = TRACK_BEST[t.id];
    if (tb) {
      const carName = (id: string) => getCar(id).name.toUpperCase();
      this.classInfo.setText(tb.cheapCar === tb.car ? `BEST: ${carName(tb.car)}` : `BEST: ${carName(tb.car)}   $1K: ${carName(tb.cheapCar)}`);
    }

    const rec = getRecord(t.id);
    this.info.setText(`${t.laps} LAPS   BEST ${rec.best !== undefined ? formatTime(rec.best) : '--:--.---'}`);
  }
}
