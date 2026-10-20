import Phaser from 'phaser';
import { Car } from '../game/Car';
import { DRIFT_MIN_SPEED, DRIFT_SLIP, ZONE_CHARGE_MULT, chargeBoost, drainBoost } from '../game/carPhysics';
import type { SurfaceFlags } from '../game/surfaces';
import type { CarStats } from '../game/cars';
import { GAME_HEIGHT, GAME_WIDTH, SceneKey } from '../game/config';
import { getName, setName } from '../game/player';
import { askName } from '../game/nameDialog';
import { MiniMap } from '../game/MiniMap';
import type { Pt } from '../game/spline';
import { addCoins, equippedStats, selectedCar } from '../game/profile';
import { Overlay, type OverlayEntry } from '../game/ui';
import { firebaseConfigured } from '../net/firebase';
import { submitScore, formatScore, type SubmitResult } from '../net/leaderboard';
import { HeatMeter } from '../game/HeatMeter';
import { quality } from '../game/quality';

type KeyName = 'up' | 'down' | 'left' | 'right' | 'w' | 'a' | 's' | 'd' | 'space' | 'shift' | 'x' | 'comma';
export type DriveState = 'countdown' | 'racing' | 'finished';

export interface Spawn {
  x: number;
  y: number;
  heading: number;
}

/** Furthest the speed zoom pulls out; scenes with a screen-sized background must cover GAME_WIDTH / MIN_ZOOM. */
export const MIN_ZOOM = 0.86;
const ZOOM_SPEED = 0.11; // zoom-out at top speed
const SKID_CAP = 600;
const SKID_LIFE = 9000;
const SKID_STEPS = 5;
const CAM_LOOKAHEAD = 0.3; // seconds of travel the camera leads by
const CAM_STIFFNESS = 8; // higher = tighter follow (per second)
const CAM_DEAD_X = 60; // the car never strays further than this from screen centre (half-screen is 160x90)
const CAM_DEAD_Y = 34;
const DRIFT_COIN_RATE = 6; // coins per second at full slip (before the chain multiplier)
const DRIFT_BANK_DELAY = 0.5; // seconds of straight driving before a drift chain is banked

/** Shared driving loop: countdown, input, car effects, pause/restart/respawn. */
export abstract class DriveScene extends Phaser.Scene {
  protected car!: Car;
  protected state: DriveState = 'countdown';
  protected raceTime = 0;
  protected overlay!: Overlay;
  protected restartLabel = 'Restart';
  /** OVERSTEER mode: throttle and boost are held for you; you only steer. */
  protected autoDrive = false;

  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private hud!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private mini!: MiniMap;
  private heatMeter!: HeatMeter;
  private banner!: Phaser.GameObjects.Text;
  private flash!: Phaser.GameObjects.Text;
  private smoke!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private flame!: Phaser.GameObjects.Particles.ParticleEmitter;
  private boostGfx!: Phaser.GameObjects.Graphics;
  protected boost = 0; // 0..1
  private skidGfx!: Phaser.GameObjects.Graphics;
  private skids: Array<[number, number, number, number]> = []; // x, y, time laid, (unused)
  private skidDrawn = 0;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  protected wasBoosting = false;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private pendingUi: Phaser.GameObjects.GameObject[] = [];
  private vignette!: Phaser.GameObjects.Image;
  private zoom = 1;
  private countdown = 3;
  /** Seconds of countdown before the race starts. */
  protected countdownFrom = 3;
  /** False in practice modes, which pay no coins. */
  protected showCoins = true;
  private paused = false;
  private wasPad = false;
  private camPos = new Phaser.Math.Vector2();
  private runId = 0;
  private stats!: CarStats;
  private coinText!: Phaser.GameObjects.Text;
  private keyDebug!: Phaser.GameObjects.Text;
  private driftChain = 0; // uncollected: lost if you hit the grass
  private chainTime = 0;
  private slideIdle = 0;
  private lostTimer = 0;
  protected driftBank = 0; // collected this run
  private paidCoins = 0;
  private finishCfg: { title: string; lines: string[] } | null = null;

  /** Build the world; return where the car starts. */
  protected abstract setupWorld(): Spawn;
  /** Per-frame mode logic (progress, laps, ...). Returns true when the car is on grass. */
  protected abstract updateMode(dt: number): boolean;
  /** Special surface under the car (gravel, boost pad, drift zone); set by the mode in updateMode. */
  protected surface: SurfaceFlags = { rough: false, pad: false, zone: false };
  protected abstract hudLines(): string[];
  /** Whole-track outline for the minimap, or null to follow the car (endless). */
  protected abstract mapStatic(): Pt[] | null;
  /** Road points near the car, for the following minimap. */
  /** Extra minimap dots (police). */
  protected mapMarkers(): Pt[] {
    return [];
  }
  protected mapNearby(): Pt[] {
    return [];
  }
  /** Coins the mode itself has earned so far (finish payout, distance...). */
  protected abstract modeCoins(): number;
  protected abstract pauseInfo(): { title: string; lines: string[] };
  /** Where to put the car when the player respawns. */
  protected abstract respawnPoint(): Spawn;
  protected abstract restart(): void;
  /** Leaderboard id for this mode (track id or 'endless'). */
  protected abstract board(): string;
  protected afterUpdate(_dt: number): void {}
  /** Lets a mode adjust the equipped car's stats (applied before OVERSTEER's boost changes). */
  protected tuneStats(stats: CarStats): CarStats {
    return stats;
  }

  create(): void {
    this.state = 'countdown';
    this.raceTime = 0;
    this.countdown = this.countdownFrom;
    this.paused = false;
    this.skids = [];
    this.boost = 1;
    this.runId++;
    this.finishCfg = null;
    this.driftChain = 0;
    this.chainTime = 0;
    this.slideIdle = 0;
    this.lostTimer = 0;
    this.driftBank = 0;
    this.paidCoins = 0;
    this.wasPad = false;
    this.surface = { rough: false, pad: false, zone: false };
    this.stats = this.tuneStats(equippedStats());
    if (this.autoDrive) {
      // OVERSTEER: a much stronger boost that refills much faster (but it can still run dry).
      this.stats = { ...this.stats, boostSpeed: this.stats.boostSpeed * 1.3, boostCharge: this.stats.boostCharge * 2.5 };
      this.boost = 1;
    }

    this.zoom = 1;
    this.setupCameras();
    const spawn = this.setupWorld();

    this.skidGfx = this.add.graphics().setDepth(2);
    this.car = new Car(this, spawn.x, spawn.y, spawn.heading, this.stats, `car-${selectedCar().id}`);

    this.smoke = this.add.particles(0, 0, 'puff', {
      lifespan: 450, speed: { min: 4, max: 14 }, scale: { start: 0.5, end: 1.4 },
      alpha: { start: 0.55, end: 0 }, tint: 0xdfe7ef, emitting: false,
    }).setDepth(11);
    this.dust = this.add.particles(0, 0, 'speck', {
      lifespan: 500, speed: { min: 8, max: 26 }, scale: { start: 1, end: 2.2 }, rotate: { min: 0, max: 360 },
      alpha: { start: 0.7, end: 0 }, tint: 0xa78a5a, emitting: false,
    }).setDepth(11);

    this.flame = this.add.particles(0, 0, 'spark', {
      lifespan: 220, speed: { min: 20, max: 50 }, scale: { start: 1.4, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0xffd166, 0xf4a261, 0xe63946], emitting: false,
    }).setDepth(9);
    this.sparks = this.add.particles(0, 0, 'spark', {
      lifespan: 350, speed: { min: 40, max: 110 }, scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 }, tint: [0xfff1b8, 0xffd166], emitting: false,
    }).setDepth(11);

    // The camera is driven by hand (see updateCamera) so it can't fall behind a fast car.
    this.camPos.set(this.car.x, this.car.y);
    this.cameras.main.centerOn(this.camPos.x, this.camPos.y);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('up,down,left,right,w,a,s,d,space,shift,x,comma') as typeof this.keys;
    kb.on('keydown-ESC', () => this.togglePause());
    const nav = (d: number) => this.overlay.visible && this.overlay.move(d);
    kb.on('keydown-UP', () => nav(-1));
    kb.on('keydown-DOWN', () => nav(1));
    kb.on('keydown-W', () => nav(-1));
    kb.on('keydown-S', () => nav(1));
    kb.on('keydown-ENTER', () => (this.overlay.visible ? this.overlay.activate() : this.respawn()));
    kb.on('keydown-R', () => this.restart());
    // Progress is written when the tab is hidden or closing, when the window loses focus mid-run, and every few
    // seconds, so closing the tab can no longer lose the coins and distance of the run in progress.
    const flush = () => this.autosave();
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    const autoPause = () => { if (this.state === 'racing' && !this.paused) this.togglePause(); };
    this.game.events.on(Phaser.Core.Events.BLUR, autoPause);
    const saver = this.time.addEvent({ delay: 8000, loop: true, callback: flush });
    this.events.once('shutdown', () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      this.game.events.off(Phaser.Core.Events.BLUR, autoPause);
      saver.remove();
      kb.removeAllListeners();
      this.settle();
    });

    const text = { fontFamily: 'monospace', fontSize: '8px', color: '#ffffff', stroke: '#14121f', strokeThickness: 2 };
    this.hud = this.add.text(4, 4, '', text).setScrollFactor(0).setDepth(100);
    this.banner = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, '', { ...text, fontSize: '32px', color: '#ffd166', strokeThickness: 4 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(100);
    this.flash = this.add.text(GAME_WIDTH / 2, 30, '', { ...text, fontSize: '12px', color: '#ffd166', strokeThickness: 3 })
      .setOrigin(0.5).setScrollFactor(0).setDepth(100);
    // Press K to see which keys the game currently receives (handy for diagnosing keyboard ghosting).
    this.keyDebug = this.add.text(GAME_WIDTH / 2, 48, '', { ...text, color: '#9ad1ff' }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100).setVisible(false);
    kb.on('keydown-K', () => this.keyDebug.setVisible(!this.keyDebug.visible));
    this.coinText = this.add.text(GAME_WIDTH / 2, 4, '', text).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
    this.hint = this.add.text(4, GAME_HEIGHT - 4, this.autoDrive ? 'AUTO THROTTLE + BOOST  X handbrake  R restart' : 'SPACE boost  X handbrake  R restart', { ...text, color: '#c9d1e3' })
      .setOrigin(0, 1).setScrollFactor(0).setDepth(100);
    this.mini = new MiniMap(this, this.mapStatic());
    this.heatMeter = new HeatMeter(this);

    this.add
      .text(GAME_WIDTH - 4, 4, 'MENU [ESC]', { ...text, backgroundColor: '#14121fcc', padding: { x: 4, y: 3 } })
      .setOrigin(1, 0).setScrollFactor(0).setDepth(100)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.togglePause());

    this.boostGfx = this.add.graphics().setScrollFactor(0).setDepth(100);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 28, 'BOOST', { fontFamily: 'monospace', fontSize: '7px', color: '#8d99ae' })
      .setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
    this.vignette = this.add.image(0, 0, 'vignette').setOrigin(0).setScrollFactor(0).setDepth(90);
    this.overlay = new Overlay(this);
  }

  /**
   * The main camera shows the world (and zooms with speed). HUD objects (screen-fixed, depth >= 90) live on a
   * second, un-zoomed camera, so zooming never scales or shifts them. Every new object starts out world-only
   * and is moved over just before rendering once its scroll factor and depth are known.
   */
  private setupCameras(): void {
    this.uiCam = this.cameras.add(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.pendingUi = [];
    type Obj = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.ScrollFactor & Phaser.GameObjects.Components.Depth;
    const onAdd = (o: Phaser.GameObjects.GameObject) => { this.uiCam.ignore(o); this.pendingUi.push(o); };
    const sort = () => {
      for (const o of this.pendingUi as Obj[]) {
        if (o.scene && o.scrollFactorX === 0 && o.depth >= 90) {
          o.cameraFilter &= ~this.uiCam.id;
          this.cameras.main.ignore(o);
        }
      }
      this.pendingUi.length = 0;
    };
    this.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdd);
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, sort);
    this.events.once('shutdown', () => {
      this.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAdd);
      this.events.off(Phaser.Scenes.Events.PRE_RENDER, sort);
    });
  }

  /** Zooms out and darkens the edges as the car speeds up. */
  private updateSpeedFx(dt: number): void {
    const st = this.car.stats;
    const frac = Phaser.Math.Clamp(this.car.speed / (st.maxSpeed * st.boostSpeed), 0, 1);
    // Low quality: no zoom (a fractional zoom makes the GPU resample the whole screen) and no full-screen vignette.
    const target = quality.low ? 1 : 1 - ZOOM_SPEED * frac;
    this.zoom += (target - this.zoom) * (1 - Math.exp(-4 * dt));
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.zoom, MIN_ZOOM, 1));
    this.vignette.setVisible(!quality.low).setAlpha(0.45 + 0.35 * frac);
  }

  /**
   * Writes the progress that's safe to write mid-run: coins already earned (an unbanked drift chain is left alone,
   * since it can still be lost on the grass). Cheap and idempotent; modes add their own bests.
   */
  protected autosave(): void {
    if (this.state === 'countdown') return;
    const owed = Math.floor(this.driftBank + this.modeCoins()) - this.paidCoins;
    if (owed <= 0) return;
    this.paidCoins += owed;
    addCoins(owed);
  }

  /** Banks the current drift chain and pays out everything earned so far; returns the coins just added. */
  protected settle(): number {
    this.bankChain();
    const owed = Math.floor(this.driftBank + this.modeCoins()) - this.paidCoins;
    if (owed <= 0) return 0;
    this.paidCoins += owed;
    addCoins(owed);
    return owed;
  }

  protected get coinsPaid(): number {
    return this.paidCoins;
  }

  private bankChain(): void {
    this.driftBank += this.driftChain;
    this.driftChain = 0;
    this.chainTime = 0;
  }

  protected shake(ms: number, intensity: number): void {
    if (!quality.low) this.cameras.main.shake(ms, intensity);
  }

  protected showFlash(text: string, ms = 1800): void {
    this.flash.setText(text).setAlpha(1);
    this.tweens.killTweensOf(this.flash);
    this.tweens.add({ targets: this.flash, alpha: 0, delay: ms, duration: 400 });
  }

  /** End of run: the car coasts while the results panel is up. */
  protected finish(title: string, lines: string[]): void {
    this.state = 'finished';
    this.finishCfg = { title, lines: [...lines] };
    this.showFinish(0);
  }

  private showFinish(selected: number): void {
    const cfg = this.finishCfg!;
    this.overlay.show(cfg.title, cfg.lines, this.finishEntries(), selected);
  }

  /** Buttons on the end-of-run panel. */
  protected finishEntries(): OverlayEntry[] {
    return [
      { label: this.restartLabel, action: () => this.restart() },
      { label: 'Leaderboard', action: () => this.scene.start(SceneKey.Leaderboard, { board: this.board() }) },
      { label: 'Change track', action: () => this.scene.start(SceneKey.Menu) },
    ];
  }

  /** Posts a score to the global leaderboard (asking for a name first if needed) and reports the rank in the results panel. */
  protected async submitOnline(value: number, onImproved?: (r: SubmitResult) => Promise<string | void>): Promise<void> {
    if (!firebaseConfigured) return;
    const run = this.runId;
    const line = (text: string) => {
      if (run !== this.runId || !this.finishCfg || !this.overlay.visible) return;
      this.finishCfg.lines.push(text);
      this.showFinish(this.overlay.selected);
    };
    let name = getName();
    if (!name) {
      name = (await askName('', false)) ?? '';
      setName(name);
    }
    try {
      const r = await submitScore(this.board(), name, value);
      line(r.improved ? `Global rank #${r.rank ?? '?'}` : `Your best: ${formatScore(this.board(), r.best)} (#${r.rank ?? '?'})`);
      if (r.improved && onImproved) {
        try {
          const extra = await onImproved(r);
          if (extra) line(extra);
        } catch (e) {
          console.error('[ghost upload]', e);
        }
      }
    } catch (e) {
      console.error('[leaderboard]', e);
      line('Leaderboard unavailable');
    }
  }

  private respawn(): void {
    if (this.state === 'finished') return;
    const p = this.respawnPoint();
    this.car.reset(p.x, p.y, p.heading);
    this.camPos.set(p.x, p.y);
    this.showFlash('RESPAWNED', 700);
  }

  private togglePause(): void {
    if (this.state === 'finished') return;
    if (this.paused) {
      this.paused = false;
      this.overlay.hide();
      return;
    }
    this.paused = true;
    const info = this.pauseInfo();
    this.overlay.show(info.title, [...info.lines, 'SPACE boost   X handbrake   ENTER respawn'], [
      { label: 'Resume', action: () => this.togglePause() },
      { label: this.restartLabel, action: () => this.restart() },
      { label: 'Change track', action: () => this.scene.start(SceneKey.Menu) },
    ]);
  }

  update(_t: number, delta: number): void {
    if (this.paused) return;
    const dt = Math.min(delta, 50) / 1000;
    const k = this.keys;

    let throttle = 0;
    let steer = 0;
    let boosting = false;
    let handbrake = false;
    if (this.state === 'racing') {
      throttle = this.axis([k.down, k.s], [k.up, k.w]);
      steer = this.axis([k.left, k.a], [k.right, k.d]);
      boosting = (k.space.isDown || k.shift.isDown) && this.boost > 0;
      if (this.autoDrive) {
        // Throttle is held for you, and boost fires whenever there's any in the tank.
        throttle = 1;
        boosting = this.boost > 0;
      }
      handbrake = k.x.isDown || k.comma.isDown;
      this.raceTime += dt;
    } else if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.raceTime = 0;
        this.banner.setText('GO!');
        this.tweens.add({ targets: this.hint, alpha: 0, delay: 5000, duration: 800 }); // hints fade once you're racing
        this.time.delayedCall(700, () => this.banner.setText(''));
      } else {
        this.banner.setText(String(Math.ceil(this.countdown)));
      }
    }

    const off = this.updateMode(dt);
    this.car.offRoad = off;
    this.car.rough = !off && this.surface.rough;
    this.car.update(dt, throttle, steer, boosting, handbrake);
    this.updateCamera(dt);
    this.updateSpeedFx(dt);
    if (boosting && !this.wasBoosting) {
      const p = this.car.point(-8, 0);
      if (!quality.low) this.sparks.emitParticleAt(p.x, p.y, 8); // kick of sparks as the boost lights
    }
    this.wasBoosting = boosting;
    if (boosting) {
      this.boost = drainBoost(this.boost, this.stats, dt);
      const p = this.car.point(-8, 0);
      if (!quality.low) this.flame.emitParticleAt(p.x, p.y, 2);
    }
    this.effects(off, dt);
    this.pickUpPad(off);
    this.trackDrift(off, dt);
    this.drawBoost(boosting);
    // The clock text is a canvas that gets re-uploaded to the GPU whenever it changes: refresh it ~15 times a second.
    if (this.game.getFrame() % 4 === 0) this.hud.setText(this.hudLines().join('\n'));
    if (this.keyDebug.visible) {
      const down = (Object.entries(this.keys) as Array<[string, Phaser.Input.Keyboard.Key]>).filter(([, key]) => key.isDown).map(([name]) => name.toUpperCase());
      this.keyDebug.setText(`KEYS: ${down.join(' ') || '-'}`);
    }
    this.mini.update(this.car.x, this.car.y, this.mapNearby(), this.mapMarkers(), this.time.now);
    this.heatMeter.update(this.car.heat);
    this.afterUpdate(dt);
  }

  /** Drift chains earn coins; they're banked after a short straight, and lost if you touch the grass. */
  private trackDrift(off: boolean, dt: number): void {
    if (this.state === 'racing') {
      const slip = this.slipNow();
      const sliding = !off && slip > DRIFT_SLIP && this.car.speed > DRIFT_MIN_SPEED;
      if (sliding) {
        this.chainTime += dt;
        this.driftChain += slip * dt * DRIFT_COIN_RATE * (1 + this.chainTime * 0.4);
        this.slideIdle = 0;
      } else if (off && this.driftChain > 0) {
        this.driftChain = 0;
        this.chainTime = 0;
        this.lostTimer = 0.8;
      } else if (this.driftChain > 0 && (this.slideIdle += dt) > DRIFT_BANK_DELAY) {
        this.bankChain();
      }
    }
    this.lostTimer = Math.max(0, this.lostTimer - dt);

    const total = Math.floor(this.driftBank + this.modeCoins());
    if (this.driftChain >= 1) this.coinText.setText(`DRIFT +${Math.floor(this.driftChain)}`).setColor('#f4a261');
    else if (this.lostTimer > 0) this.coinText.setText('DRIFT LOST').setColor('#e63946');
    else this.coinText.setText(total > 0 ? `COINS +${total}` : '').setColor('#ffd166');
    if (!this.showCoins) this.coinText.setText('');
  }

  /**
   * Look ahead along the velocity, smooth by real time (not per frame), and never let the car
   * leave a dead zone around the screen centre, however fast it goes or however low the frame rate.
   */
  private updateCamera(dt: number): void {
    const v = this.car.velocity;
    const tx = this.car.x + v.x * CAM_LOOKAHEAD;
    const ty = this.car.y + v.y * CAM_LOOKAHEAD;
    const k = 1 - Math.exp(-CAM_STIFFNESS * dt);
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.y += (ty - this.camPos.y) * k;
    this.camPos.x = Phaser.Math.Clamp(this.camPos.x, this.car.x - CAM_DEAD_X, this.car.x + CAM_DEAD_X);
    this.camPos.y = Phaser.Math.Clamp(this.camPos.y, this.car.y - CAM_DEAD_Y, this.car.y + CAM_DEAD_Y);
    this.cameras.main.centerOn(Math.round(this.camPos.x), Math.round(this.camPos.y));
  }

  /**
   * -1, 0 or +1 from a pair of opposing key groups. If both sides are held (e.g. you press Left a moment
   * before letting go of Right) the most recently pressed one wins, instead of cancelling out.
   */
  private axis(neg: Phaser.Input.Keyboard.Key[], pos: Phaser.Input.Keyboard.Key[]): number {
    const n = neg.filter((key) => key.isDown);
    const p = pos.filter((key) => key.isDown);
    if (n.length && p.length) {
      const last = (keys: Phaser.Input.Keyboard.Key[]) => Math.max(...keys.map((key) => key.timeDown));
      return last(p) > last(n) ? 1 : -1;
    }
    return p.length ? 1 : n.length ? -1 : 0;
  }

  private drawBoost(boosting: boolean): void {
    const w = 80;
    const x = (GAME_WIDTH - w) / 2;
    const y = GAME_HEIGHT - 20;
    const full = this.boost >= 1;
    this.boostGfx.clear()
      .fillStyle(0x14121f, 0.8).fillRect(x - 2, y - 2, w + 4, 8)
      .fillStyle(boosting ? 0xe63946 : full ? 0xffd166 : 0xf4a261).fillRect(x, y, Math.floor(w * this.boost), 4);
  }

  /** Sideways slip as the game counts it: in drift zones it ignores tyre heat. */
  private slipNow(): number {
    return this.surface.zone ? this.car.phys.rawSlip : this.car.slip;
  }

  /** Boost pads refill part of the boost meter once per pass (more for cars with a high padGain). */
  private pickUpPad(off: boolean): void {
    const now = !off && this.surface.pad;
    if (now && !this.wasPad && this.state === 'racing') {
      this.boost = Math.min(1, this.boost + this.stats.padGain);
      this.showFlash('BOOST PAD!', 600);
      this.shake(160, 0.005);
    }
    this.wasPad = now;
  }

  private effects(off: boolean, dt: number): void {
    if (off) {
      if (this.car.speed > 25) {
        if (this.car.speed > 60) this.shake(70, 0.0025); // rumble over the grass
        const p = this.car.point(-7, 0);
        if (!quality.low) this.dust.emitParticleAt(p.x, p.y, 1);
      }
    } else if (this.slipNow() > DRIFT_SLIP && this.car.speed > DRIFT_MIN_SPEED) {
      for (const side of quality.low ? [] : [-3, 3]) {
        const p = this.car.point(-5, side);
        const x = Math.floor(p.x), y = Math.floor(p.y);
        this.skids.push([x, y, this.time.now, 1]);
        this.skidGfx.fillStyle(0x14121f, 0.45).fillRect(x, y, 1, 1); // a new mark is drawn straight away...
      }
      if (this.skids.length > SKID_CAP) this.skids.splice(0, this.skids.length - SKID_CAP);
      // in a drift zone slip ignores tyre heat and charges boost faster
      if (this.state === 'racing') this.boost = chargeBoost(this.boost, this.slipNow() * (this.surface.zone ? ZONE_CHARGE_MULT : 1), this.stats, dt);
      const rear = this.car.point(-7, 0);
      if (!quality.low) this.smoke.emitParticleAt(rear.x, rear.y, 1);
    }

    // Marks fade out over SKID_LIFE ms. ...and the whole set is repainted only a few times a second (also dropping
    // the expired ones), in just a few opacity steps, oldest first. Repainting every frame replayed up to
    // SKID_CAP rectangles 60 times a second for as long as you drifted.
    const now = this.time.now;
    if (this.skids.length && now - this.skidDrawn > 200) {
      while (this.skids.length && now - this.skids[0][2] > SKID_LIFE) this.skids.shift();
      this.skidGfx.clear();
      let step = -1;
      for (const [x, y, t] of this.skids) {
        const s = Math.min(SKID_STEPS - 1, Math.floor((1 - (now - t) / SKID_LIFE) * SKID_STEPS));
        if (s !== step) { this.skidGfx.fillStyle(0x14121f, (0.45 * (s + 1)) / SKID_STEPS); step = s; }
        this.skidGfx.fillRect(x, y, 1, 1);
      }
      this.skidDrawn = now;
    }
  }
}
