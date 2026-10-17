import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { selectedCar } from '../game/profile';
import { paintRoad, paintStartLine, type RoadPt } from '../game/Track';

// Framed showcase panel (same style as the menu's track preview) with an oval the cars drift around.
const PANEL = { x: 40, y: 46, w: 240, h: 80 };
const OVAL = { cx: GAME_WIDTH / 2, cy: PANEL.y + PANEL.h / 2, rx: 100, ry: 23, half: 10 };
const LAP_SECONDS = 4.5;

interface Drifter {
  car: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  phase: number;
}

/** Home screen: title, a car drifting in a framed panel, and a PLAY / GARAGE / LEADERBOARD list. */
export class TitleScene extends Phaser.Scene {
  private cars: Drifter[] = [];
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private skids!: Phaser.GameObjects.Graphics;
  private items: Phaser.GameObjects.Text[] = [];
  private sel = 0;
  private t = 0;
  private leaving = false;

  private readonly entries: Array<[string, string]> = [
    ['PLAY', SceneKey.Menu],
    ['GARAGE', SceneKey.Garage],
    ['LEADERBOARD', SceneKey.Leaderboard],
  ];

  constructor() {
    super(SceneKey.Title);
  }

  create(): void {
    this.t = 0;
    this.sel = 0;
    this.leaving = false;
    this.cars = [];
    const mono = { fontFamily: 'monospace', color: '#ffffff' };

    this.add.text(GAME_WIDTH / 2, 18, 'OVERSTEER', { ...mono, fontSize: '24px', color: '#ffd166' }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 36, 'a pixel drifting game', { ...mono, fontSize: '8px', color: '#8d99ae' }).setOrigin(0.5);

    this.buildShowcase();

    this.items = this.entries.map(([label], i) =>
      this.add.text(GAME_WIDTH / 2, 138 + i * 12, label, { ...mono, fontSize: '10px' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.select(i))
        .on('pointerdown', () => this.go(i)),
    );
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 6, 'UP/DOWN select   ENTER confirm', { ...mono, fontSize: '8px', color: '#8d99ae' }).setOrigin(0.5);
    this.select(0);

    const kb = this.input.keyboard!;
    const move = (d: number) => this.select((this.sel + d + this.entries.length) % this.entries.length);
    kb.on('keydown-UP', () => move(-1));
    kb.on('keydown-DOWN', () => move(1));
    kb.on('keydown-W', () => move(-1));
    kb.on('keydown-S', () => move(1));
    kb.on('keydown-ENTER', () => this.go(this.sel));
    kb.on('keydown-SPACE', () => this.go(this.sel));
    this.events.once('shutdown', () => kb.removeAllListeners());

    this.cameras.main.fadeIn(250, 20, 18, 31);
  }

  /** Grass, an oval road and two drifting cars, clipped to a framed panel. */
  private buildShowcase(): void {
    const clip = this.make.graphics({}, false).fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h).createGeometryMask();
    const inPanel = <T extends Phaser.GameObjects.Components.Mask>(o: T): T => o.setMask(clip);

    inPanel(this.add.tileSprite(PANEL.x, PANEL.y, PANEL.w, PANEL.h, 'ground-grass').setOrigin(0));
    const n = 160;
    const pts: RoadPt[] = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: OVAL.cx + Math.cos(a) * OVAL.rx, y: OVAL.cy + Math.sin(a) * OVAL.ry, half: OVAL.half };
    });
    const kerb = inPanel(this.add.graphics().setDepth(1));
    const road = inPanel(this.add.graphics().setDepth(1.1));
    paintRoad(kerb, road, new Phaser.Math.RandomDataGenerator(['title']), pts, 0, n - 1);
    paintStartLine(road, pts[n / 2], pts[n / 2 + 2], OVAL.half * 2);
    this.skids = inPanel(this.add.graphics().setDepth(2));

    const mine = selectedCar().id;
    const rival = mine === 'legend' ? 'rocket' : 'legend';
    for (const [id, phase] of [[mine, 0], [rival, -0.7]] as const) {
      this.cars.push({
        shadow: inPanel(this.add.image(0, 0, `car-${id}-shadow`).setAlpha(0.35).setDepth(9)),
        car: inPanel(this.add.image(0, 0, `car-${id}`).setDepth(10)),
        phase,
      });
    }
    this.smoke = inPanel(this.add.particles(0, 0, 'smoke', {
      lifespan: 600, speed: { min: 4, max: 12 }, scale: { start: 1, end: 3 },
      alpha: { start: 0.5, end: 0 }, tint: 0xdfe7ef, emitting: false,
    }).setDepth(11));

    // frame drawn on top, like the menu's track preview box
    this.add.rectangle(PANEL.x, PANEL.y, PANEL.w, PANEL.h).setOrigin(0).setStrokeStyle(1, 0x3d405b).setDepth(20);
  }

  private select(i: number): void {
    this.sel = i;
    this.items.forEach((t, k) => {
      const on = k === i;
      t.setText((on ? '> ' : '  ') + this.entries[k][0] + (on ? '  ' : '  ')).setColor(on ? '#ffd166' : '#ffffff');
    });
  }

  private go(i: number): void {
    if (this.leaving) return;
    this.leaving = true;
    this.select(i);
    this.cameras.main.fadeOut(200, 20, 18, 31);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(this.entries[i][1]));
  }

  update(_time: number, delta: number): void {
    const lap = Math.floor(this.t / LAP_SECONDS);
    this.t += delta / 1000;
    if (Math.floor(this.t / LAP_SECONDS) !== lap) this.skids.clear(); // fresh marks each lap, so they never pile up

    for (const d of this.cars) {
      const a = (this.t / LAP_SECONDS) * Math.PI * 2 + d.phase;
      const x = OVAL.cx + Math.cos(a) * OVAL.rx;
      const y = OVAL.cy + Math.sin(a) * OVAL.ry;
      // travel direction, with the nose turned in towards the corner like a drift
      const travel = Math.atan2(Math.cos(a) * OVAL.ry, -Math.sin(a) * OVAL.rx);
      const bend = Math.abs(Math.cos(a)); // the ends of the oval are the corners
      const heading = travel + 0.6 * bend;
      d.car.setPosition(x, y).setRotation(heading);
      d.shadow.setPosition(x + 1, y + 2).setRotation(heading);
      if (bend > 0.7) {
        const bx = x - Math.cos(heading) * 6, by = y - Math.sin(heading) * 6;
        this.smoke.emitParticleAt(bx, by, 1);
        for (const side of [-3, 3]) {
          this.skids.fillStyle(0x14121f, 0.25).fillRect(Math.floor(bx - Math.sin(heading) * side), Math.floor(by + Math.cos(heading) * side), 1, 1);
        }
      }
    }
  }
}
