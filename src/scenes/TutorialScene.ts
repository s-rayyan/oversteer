import Phaser from 'phaser';
import { DRIFT_MIN_SPEED, DRIFT_SLIP } from '../game/carPhysics';
import { GAME_WIDTH, SceneKey } from '../game/config';
import type { Pt } from '../game/spline';
import { surfaceFlags, type SurfaceFlags } from '../game/surfaces';
import { buildTrack, type RoadPt } from '../game/Track';
import type { TrackDef } from '../game/tracks';
import { markTutorialSeen } from '../game/tutorial';
import type { OverlayEntry } from '../game/ui';
import { DriveScene, type Spawn } from './DriveScene';

/** A wide, forgiving stadium loop with one boost pad on the top straight. Not part of the track list. */
const PRACTICE: TrackDef = {
  id: 'practice', name: 'Practice Track', group: 'practice', difficulty: 'Easy', theme: 'grass',
  points: [[300, 100], [900, 100], [1120, 260], [900, 420], [300, 420], [80, 260]],
  roadWidth: 110, laps: 1, pads: [0.2],
};

const WINDOW = 40;

interface Step {
  title: string;
  text: string[];
}

const STEPS: Step[] = [
  { title: 'DRIVE', text: ['Hold UP (or W) to speed up.', 'LEFT / RIGHT to steer.'] },
  { title: 'DRIFT', text: ['Steering heats your tyres.', 'Hot tyres slide: corner fast or tap X.'] },
  { title: 'BOOST', text: ['Hold SPACE to boost.', 'Use it until the bar is nearly empty.'] },
  { title: 'REFILL', text: ['Drifting refills the boost bar.', 'Slide around until it is mostly full.'] },
  { title: 'BOOST PAD', text: ['Drive over the yellow pad on the', 'straight to top up your boost.'] },
];

const DRIVE_PX = 500; // distance to drive in step 1
const DRIFT_SECONDS = 2; // time spent sliding in step 2
const BOOST_SECONDS = 6; // step 3 also ends after this much boosting, whatever the bar says
const BOOST_LOW = 0.3; // bar level that counts as "nearly empty"
const BOOST_REFILLED = 0.7; // bar level that counts as "most of the way full"

/** Guided practice: five short tasks that teach steering, drifting, boosting and boost pads. */
export class TutorialScene extends DriveScene {
  private samples: RoadPt[] = [];
  private flags: SurfaceFlags[] = [];
  private idx = 0;
  private step = 0;
  private acc = 0; // progress within the current step (px, or seconds)
  private offNow = false;
  private wasPadNow = false;
  private panel!: Phaser.GameObjects.Rectangle;
  private title!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private bar!: Phaser.GameObjects.Graphics;

  constructor() {
    super(SceneKey.Tutorial);
    this.restartLabel = 'Replay tutorial';
    this.countdownFrom = 0.4;
    this.showCoins = false;
  }

  protected setupWorld(): Spawn {
    markTutorialSeen();
    const built = buildTrack(this, PRACTICE);
    this.samples = built.samples;
    this.flags = surfaceFlags(this.samples.length, PRACTICE);
    const b = built.bounds;
    this.cameras.main.setBounds(b.x, b.y, b.width, b.height);
    this.idx = this.samples.length - 14;
    this.step = 0;
    this.acc = 0;
    this.wasPadNow = false;

    this.panel = this.add.rectangle(GAME_WIDTH / 2, 43, 204, 46, 0x14121f, 0.9).setStrokeStyle(1, 0xffd166).setScrollFactor(0).setDepth(100);
    const font = { fontFamily: 'monospace', fontSize: '8px', color: '#c9d1e3' };
    this.title = this.add.text(GAME_WIDTH / 2, 25, '', { ...font, color: '#ffd166' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(101);
    this.body = this.add.text(GAME_WIDTH / 2, 36, '', { ...font, align: 'center' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(101);
    this.bar = this.add.graphics().setScrollFactor(0).setDepth(101);
    this.showStep();
    return this.pointAt(this.idx);
  }

  private pointAt(i: number): Spawn {
    const n = this.samples.length;
    const p = this.samples[i];
    const q = this.samples[(i + 3) % n];
    return { x: p.x, y: p.y, heading: Math.atan2(q.y - p.y, q.x - p.x) };
  }

  protected respawnPoint(): Spawn {
    return this.pointAt(this.idx);
  }

  protected updateMode(): boolean {
    const n = this.samples.length;
    let best = this.idx;
    let bd = Infinity;
    for (let d = -WINDOW; d <= WINDOW; d++) {
      const j = (this.idx + d + n) % n;
      const dx = this.samples[j].x - this.car.x;
      const dy = this.samples[j].y - this.car.y;
      const dist = dx * dx + dy * dy;
      if (dist < bd) { bd = dist; best = j; }
    }
    this.idx = best;
    this.surface = this.flags[best];
    this.offNow = Math.sqrt(bd) > this.samples[best].half;
    return this.offNow;
  }

  private showStep(): void {
    const s = STEPS[this.step];
    this.title.setText(`${this.step + 1}/${STEPS.length}  ${s.title}`);
    this.body.setText(s.text.join('\n'));
    this.bar.clear();
    this.acc = 0;
  }

  private drifting(): boolean {
    return !this.offNow && this.car.slip > DRIFT_SLIP && this.car.speed > DRIFT_MIN_SPEED;
  }

  protected afterUpdate(dt: number): void {
    if (this.state !== 'racing') return;
    let frac = 0; // 0..1 progress bar for the current step; pad has no bar
    let done = false;
    switch (this.step) {
      case 0:
        this.acc += this.car.speed * dt;
        frac = this.acc / DRIVE_PX;
        done = frac >= 1;
        break;
      case 1:
        if (this.drifting()) this.acc += dt;
        frac = this.acc / DRIFT_SECONDS;
        done = frac >= 1;
        break;
      case 2:
        if (this.wasBoosting) this.acc += dt;
        frac = (1 - this.boost) / (1 - BOOST_LOW);
        done = this.boost <= BOOST_LOW || this.acc >= BOOST_SECONDS;
        break;
      case 3:
        frac = (this.boost - BOOST_LOW) / (BOOST_REFILLED - BOOST_LOW);
        done = this.boost >= BOOST_REFILLED;
        break;
      default: {
        const onPad = !this.offNow && this.surface.pad;
        done = onPad && !this.wasPadNow;
        this.wasPadNow = onPad;
      }
    }

    const w = 150;
    this.bar.clear();
    if (this.step < 4) {
      this.bar.fillStyle(0x3d405b).fillRect((GAME_WIDTH - w) / 2, 58, w, 2)
        .fillStyle(0xffd166).fillRect((GAME_WIDTH - w) / 2, 58, Math.floor(w * Phaser.Math.Clamp(frac, 0, 1)), 2);
    }
    if (!done) return;

    this.step++;
    if (this.step < STEPS.length) {
      this.showFlash('NICE!', 700);
      this.showStep();
    } else {
      this.panel.setVisible(false);
      this.title.setVisible(false);
      this.body.setVisible(false);
      this.bar.clear();
      this.finish('TUTORIAL DONE', [
        'You know the basics:',
        'steer to heat tyres, drift to fill',
        'boost, SPACE to use it, pads to top up.',
        'Now go set a time!',
      ]);
    }
  }

  protected finishEntries(): OverlayEntry[] {
    return [
      { label: 'Play', action: () => this.scene.start(SceneKey.Menu) },
      { label: 'Replay tutorial', action: () => this.restart() },
    ];
  }

  protected hudLines(): string[] {
    return [];
  }

  protected mapStatic(): Pt[] {
    return this.samples;
  }

  protected pauseInfo(): { title: string; lines: string[] } {
    return { title: 'PAUSED', lines: ['Practice Track', `Step ${Math.min(this.step + 1, STEPS.length)} of ${STEPS.length}`] };
  }

  /** Practice earns nothing, so repeating it can't be used to farm drift coins. */
  protected settle(): number {
    return 0;
  }

  protected modeCoins(): number {
    return 0;
  }

  protected board(): string {
    return PRACTICE.id;
  }

  protected restart(): void {
    this.scene.restart();
  }
}
