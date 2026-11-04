import * as THREE from 'three';
import Phaser from 'phaser';
import { SceneKey } from '../game/config';
import { recordId } from '../game/dimension';
import { DRIFT_MIN_SPEED, DRIFT_SLIP } from '../game/carPhysics';
import { getCar } from '../game/cars';
import type { GhostRunner } from '../game/GhostRunner';
import { equippedPaint, equippedSmoke, selectedCar } from '../game/profile';
import { quality } from '../game/quality';
import { KERB, trackLayout, type BuiltTrack } from '../game/Track';
import { buildCar, type CarModel } from '../three/carModel';
import { Particles, SkidMarks, Weather, displayColor } from '../three/fx';
import { getStage, type Stage3D } from '../three/stage';
import { worldFor, type World3D } from '../three/world';
import type { Spawn } from './DriveScene';
import { RaceScene } from './RaceScene';

type CamMode = 'chase' | 'far' | 'hood' | 'high';
const CAM_MODES: CamMode[] = ['chase', 'far', 'hood', 'high'];
const CAM_LABEL: Record<CamMode, string> = { chase: 'CHASE CAM', far: 'FAR CHASE CAM', hood: 'BONNET CAM', high: 'HIGH CAM' };
/** Distance behind, height, look-ahead and look height of each follow camera (world units = 2D pixels). */
const CAM_RIG: Record<Exclude<CamMode, 'hood'>, [number, number, number, number]> = {
  chase: [32, 16, 18, 2],
  far: [56, 30, 26, 1],
  high: [55, 90, 14, 0],
};
const CAM_KEY = 'oversteer.cam3d';
const WEATHER_COUNT = { snow: 1400, rain: 1100, dust: 260 } as const;

const loadCam = (): CamMode => {
  try {
    const m = localStorage.getItem(CAM_KEY) as CamMode | null;
    return m && CAM_MODES.includes(m) ? m : 'chase';
  } catch {
    return 'chase';
  }
};

/** The track the opening camera sweep was last shown on: restarting the same track (R) skips it. */
let introShown = '';
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * A circuit race in 3D. All of the racing is RaceScene's (and DriveScene's): the same car physics, laps, timing,
 * coins, drift chains, boost pads, ghosts, pause and results, so the 3D game plays exactly like the 2D one. Only
 * the picture changes: the 2D world camera is switched off and three.js draws the track and the car from behind,
 * under Phaser's HUD. The hills are scenery only: the car is drawn on them, but it is driven on the flat 2D map.
 * Records, ghosts and leaderboards are the 3D game's own (`3d:` ids, see dimension.ts).
 */
export class Race3DScene extends RaceScene {
  private stage!: Stage3D;
  private world!: World3D;
  private readonly cam3 = new THREE.PerspectiveCamera(64, 16 / 9, 1, 6000);
  private model!: CarModel;
  private ghosts = new Map<GhostRunner, CarModel>();
  private smoke3!: Particles;
  private flame3!: Particles;
  private skids3!: SkidMarks;
  private weather: Weather | null = null;
  private blob!: THREE.Mesh;
  private camMode: CamMode = 'chase';
  private camYaw = 0;
  private fov = 64;
  private fovKick = 0;
  private onPadBefore = false;
  private readonly eye = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private snapCam = true;
  private intro = false;
  private readonly introEye = new THREE.Vector3();
  private lastHeading = 0;
  private lastSpeed = 0;
  private steerVis = 0;
  private roll = 0;
  private pitch = 0;
  private tiltRoll = 0;
  private tiltPitch = 0;
  private carY = 0;
  private rolled = 0;
  private rumble3 = 0;
  private shakeLeft = 0;
  private shakePower = 0;
  private lastSkid: Array<{ x: number; z: number } | null> = [null, null];
  private smokeColors: THREE.Color[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly buf = new THREE.Vector2();
  private readonly dustColor = displayColor(0xa78a5a);
  private readonly gravelColor = displayColor(0xb59a6a);
  private readonly flameColors = [0xffd166, 0xf4a261, 0xe63946, 0xfff1b8].map(displayColor);

  constructor() {
    super(SceneKey.Race3D);
  }

  protected recId(): string {
    return recordId(this.track.id, '3d');
  }

  protected buildWorld(): BuiltTrack {
    return trackLayout(this.track); // nothing painted in 2D: the picture is three.js's
  }

  protected setupWorld(): Spawn {
    const spawn = super.setupWorld();
    this.cameras.main.setVisible(false);
    this.stage = getStage(this.game);
    this.world = worldFor(this.track, this.samples);
    return spawn;
  }

  create(): void {
    super.create();
    this.build3D();
    this.hint.setText('SPACE/Z boost  X handbrake  C camera  R restart');
    this.input.keyboard!.on('keydown-C', () => this.cycleCamera());
    this.events.once('shutdown', () => this.teardown3D());
  }

  private build3D(): void {
    const def = selectedCar();
    const w = this.world;
    this.model = buildCar(def, equippedPaint().color ?? def.color, { beams: w.night });
    const g = w.runGroup;
    g.add(this.model.root);

    const shadowTex = new THREE.CanvasTexture((() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d')!;
      const gr = ctx.createRadialGradient(16, 16, 2, 16, 16, 16);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 32, 32);
      return c;
    })());
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(this.model.length * 1.5, this.model.width * 1.7),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.25;
    this.model.root.add(this.blob);

    this.smoke3 = new Particles(260, false, 5, 1.8);
    this.flame3 = new Particles(140, true, 1, 4);
    this.skids3 = new SkidMarks();
    g.add(this.skids3.mesh, this.smoke3.points, this.flame3.points, this.cam3);
    const tint = equippedSmoke().tint;
    this.smokeColors = (Array.isArray(tint) ? tint : [tint]).map(displayColor);

    this.carY = w.groundY(this.car.x, this.car.y);
    this.weather = null;
    if (w.weather) {
      const n = Math.round(WEATHER_COUNT[w.weather] / (quality.low ? 3 : 1));
      this.weather = new Weather(w.weather, n, this.car.x, this.carY + 16, this.car.y);
      g.add(this.weather.obj);
    }

    this.camMode = loadCam();
    this.snapCam = true;
    // The first time a track is raced, the camera opens high over the track during the countdown and sweeps down.
    this.intro = introShown !== this.track.id;
    introShown = this.track.id;
    const f = Math.cos(this.car.facing), s = Math.sin(this.car.facing);
    this.introEye.set(this.car.x - f * w.span * 0.32, this.carY + w.span * 0.4 + 60, this.car.y - s * w.span * 0.32);
    this.lastHeading = this.car.facing;
    this.lastSpeed = 0;
    this.tiltRoll = this.tiltPitch = 0;
    this.fovKick = 0;
    this.onPadBefore = false;
    this.lastSkid = [null, null];
    this.ghosts = new Map();
    this.stage.show(true);
    this.render3D(0);
  }

  private teardown3D(): void {
    this.stage.show(false);
    this.world.runGroup.clear();
    this.model.dispose();
    this.ghosts.forEach((m) => m.dispose());
    this.ghosts.clear();
    this.smoke3.dispose();
    this.flame3.dispose();
    this.skids3.dispose();
    this.weather?.dispose();
    this.weather = null;
    this.blob.geometry.dispose();
    const bm = this.blob.material as THREE.MeshBasicMaterial;
    bm.map?.dispose();
    bm.dispose();
    this.world.flameLight.intensity = 0;
  }

  private cycleCamera(): void {
    this.camMode = CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length];
    this.snapCam = true;
    this.intro = false;
    try { localStorage.setItem(CAM_KEY, this.camMode); } catch { /* storage unavailable */ }
    this.showFlash(CAM_LABEL[this.camMode], 900, '#9ad1ff');
  }

  protected shake(ms: number, intensity: number): void {
    super.shake(ms, intensity);
    if (quality.low) return;
    this.shakeLeft = Math.max(this.shakeLeft, ms / 1000);
    this.shakePower = Math.max(this.shakePower, intensity);
  }

  protected hudLines(): string[] {
    return [...super.hudLines(), `${Math.round(this.car.speed)} KM/H`];
  }

  update(time: number, delta: number): void {
    super.update(time, delta);
    this.render3D(this.isPaused ? 0 : Math.min(delta, 50) / 1000);
  }

  private render3D(dt: number): void {
    if (!this.model) return;
    this.stage.place();
    const car = this.car;
    const ph = car.phys;
    const h = ph.heading;
    const cos = Math.cos(h);
    const sin = Math.sin(h);
    const speed = car.speed;
    const m = this.model;
    const w = this.world;
    const k = (rate: number) => 1 - Math.exp(-rate * dt);

    // The car sits on the hills: its height and tilt come from the ground under its four corners.
    const gy = (fwd: number, side: number) => {
      const p = car.point(fwd, side);
      return w.groundY(p.x, p.y);
    };
    this.carY = w.groundY(car.x, car.y);
    const pitchWant = Math.atan2(gy(m.length * 0.4, 0) - gy(-m.length * 0.4, 0), m.length * 0.8);
    const rollWant = Math.atan2(gy(0, -m.width * 0.45) - gy(0, m.width * 0.45), m.width * 0.9);
    const snap = dt === 0 || this.snapCam;
    this.tiltPitch += (pitchWant - this.tiltPitch) * (snap ? 1 : k(14));
    this.tiltRoll += (rollWant - this.tiltRoll) * (snap ? 1 : k(14));

    // body roll, pitch and steering, from what the physics did this frame
    let kerb = false;
    if (dt > 0) {
      const dh = Phaser.Math.Angle.Wrap(h - this.lastHeading);
      const turning = speed > 5 ? Phaser.Math.Clamp(dh / (Math.max(0.1, ph.stats.turnRate) * dt), -1, 1) : 0;
      this.steerVis += (turning - this.steerVis) * k(12);
      const lateral = ph.vx * -sin + ph.vy * cos;
      this.roll += (Phaser.Math.Clamp((lateral / ph.stats.maxSpeed) * 0.3, -0.09, 0.09) - this.roll) * k(8);
      const accel = (speed - this.lastSpeed) / dt;
      this.pitch += (Phaser.Math.Clamp(accel * 0.00035, -0.05, 0.05) - this.pitch) * k(6);
      this.rolled += (ph.vx * cos + ph.vy * sin) * dt;
      // running over a kerb rattles the car and the camera
      const sp = this.samples[this.idx];
      const d = Math.hypot(car.x - sp.x, car.y - sp.y);
      kerb = !car.offRoad && speed > 35 && d > sp.half - 1.5 && d < sp.half + KERB + 0.5;
    }
    this.rumble3 = kerb ? Math.min(1, this.rumble3 + dt * 8) : Math.max(0, this.rumble3 - dt * 6);
    this.lastHeading = h;
    this.lastSpeed = speed;
    m.root.position.set(car.x, this.carY, car.y);
    m.root.rotation.set(this.tiltRoll, -h, this.tiltPitch, 'YXZ');
    let bump = car.offRoad && speed > 20 && dt > 0 ? (Math.random() - 0.5) * 0.35 : 0;
    if (this.rumble3 > 0 && dt > 0) bump += Math.sin(this.time.now * 0.09) * 0.14 * this.rumble3;
    m.body.position.y = bump;
    m.body.rotation.set(this.roll, 0, this.pitch);
    m.wheels.forEach((wh, i) => { wh.rotation.z = -this.rolled / m.radii[i]; });
    m.steer.forEach((s) => { s.rotation.y = -this.steerVis * 0.42; });
    m.root.updateMatrixWorld();

    this.updateGhosts();
    if (dt > 0) this.effects3D(dt);
    this.updateCamera3D(dt);

    // lights the car carries
    if (this.wasBoosting && dt > 0) {
      this.tmp.copy(m.exhaust).applyMatrix4(m.root.matrixWorld);
      w.flameLight.position.copy(this.tmp);
      w.flameLight.intensity = 3 + Math.random() * 2;
    } else w.flameLight.intensity = 0;
    if (w.headlight) {
      w.headlight.position.set(car.x + cos * m.length * 0.5, this.carY + 4, car.y + sin * m.length * 0.5);
      w.headlight.target.position.set(car.x + cos * 70, w.groundY(car.x + cos * 70, car.y + sin * 70), car.y + sin * 70);
    }
    w.update(dt, car.x, this.carY, car.y, quality.low);
    this.weather?.update(dt, this.cam3.position.x, this.cam3.position.y, this.cam3.position.z);

    const r = this.stage.renderer;
    const scale = r.getDrawingBufferSize(this.buf).y / (2 * Math.tan(THREE.MathUtils.degToRad(this.cam3.fov) / 2));
    this.smoke3.update(dt, scale);
    this.flame3.update(dt, scale);
    r.render(w.scene, this.cam3);
  }

  /** The ghost replays (local best, online top...) as see-through cars, following their 2D runners. */
  private updateGhosts(): void {
    const runners = [this.mine, this.top, ...this.chasers.map((c) => c.runner)].filter((x): x is GhostRunner => !!x);
    for (const run of runners) {
      let gm = this.ghosts.get(run);
      if (!gm) {
        gm = buildCar(getCar(run.data.carId), run.sprite.tintTopLeft, { ghost: true, beams: this.world.night });
        this.world.runGroup.add(gm.root);
        this.ghosts.set(run, gm);
      }
      gm.root.visible = run.sprite.visible;
      if (!gm.root.visible) continue;
      const x = run.sprite.x, z = run.sprite.y;
      const dx = x - gm.root.position.x, dz = z - gm.root.position.z;
      gm.root.position.set(x, this.world.groundY(x, z), z);
      gm.root.rotation.y = -run.sprite.rotation;
      const moved = Math.hypot(dx, dz);
      if (moved < 30) gm.wheels.forEach((wh, i) => { wh.rotation.z -= moved / gm!.radii[i]; });
    }
  }

  private effects3D(dt: number): void {
    const car = this.car;
    const m = this.model;
    const w = this.world;
    const speed = car.speed;
    const slip = this.surface.zone ? car.phys.rawSlip : car.slip;
    const sliding = !car.offRoad && slip > DRIFT_SLIP && speed > DRIFT_MIN_SPEED;
    const gravel = !car.offRoad && this.surface.rough && speed > 25;
    const fx = !quality.low;
    const rear = -m.length * 0.32;
    for (let k = 0; k < 2; k++) {
      const side = (k === 0 ? -1 : 1) * m.width * 0.4;
      const p = car.point(rear, side);
      const y = w.groundY(p.x, p.y);
      if (sliding) {
        const last = this.lastSkid[k];
        if (last && Math.hypot(p.x - last.x, p.y - last.z) < 30) this.skids3.add(last.x, last.z, p.x, p.y, 1.4, y);
        this.lastSkid[k] = { x: p.x, z: p.y };
        if (fx) {
          const c = this.smokeColors[Math.floor(Math.random() * this.smokeColors.length)];
          this.smoke3.emit(p.x, y + 0.8, p.y, (Math.random() - 0.5) * 8, 2 + Math.random() * 3, (Math.random() - 0.5) * 8, 0.9 + Math.random() * 0.4, 2.5, 11 + slip * 10, c, 0.5);
        }
      } else this.lastSkid[k] = null;
      // gravel sections throw up a spray of grit from the back wheels
      if (gravel && fx && Math.random() < 0.7) {
        this.smoke3.emit(p.x, y + 0.6, p.y, (Math.random() - 0.5) * 16 - car.phys.vx * 0.15, 5 + Math.random() * 6, (Math.random() - 0.5) * 16 - car.phys.vy * 0.15,
          0.7, 2, 9, this.gravelColor, 0.55);
      }
    }
    if (car.offRoad && speed > 25 && fx) {
      const p = car.point(-m.length * 0.5, 0);
      this.smoke3.emit(p.x, w.groundY(p.x, p.y) + 0.6, p.y, (Math.random() - 0.5) * 14, 4 + Math.random() * 4, (Math.random() - 0.5) * 14, 0.6, 2, 8, this.dustColor, 0.6);
    }
    if (this.wasBoosting) {
      this.tmp.copy(m.exhaust).applyMatrix4(m.root.matrixWorld);
      const back = -45;
      const cos = Math.cos(car.facing), sin = Math.sin(car.facing);
      for (let i = 0; i < (fx ? 4 : 1); i++) {
        const c = this.flameColors[Math.floor(Math.random() * this.flameColors.length)];
        this.flame3.emit(this.tmp.x, this.tmp.y, this.tmp.z,
          car.phys.vx + cos * back + (Math.random() - 0.5) * 10, (Math.random() - 0.3) * 6, car.phys.vy + sin * back + (Math.random() - 0.5) * 10,
          0.12 + Math.random() * 0.1, 2.8, 0.6, c, 0.95);
      }
    }
    // A boost pad punches the camera forward (a kick of field of view).
    const onPad = !car.offRoad && this.surface.pad && this.state === 'racing';
    if (onPad && !this.onPadBefore) {
      this.fovKick = 14;
    }
    this.onPadBefore = onPad;
    this.fovKick *= Math.exp(-3.5 * dt);
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      if (this.shakeLeft <= 0) this.shakePower = 0;
    }
  }

  private updateCamera3D(dt: number): void {
    const car = this.car;
    const m = this.model;
    const w = this.world;
    const h = car.facing;
    const speed = car.speed;
    let dx = Math.cos(h);
    let dz = Math.sin(h);
    // In a slide the camera swings towards where the car is going, so you can see it drifting.
    if (speed > 15) {
      const wgt = 0.75 * Math.min(1, speed / 80);
      dx += (car.phys.vx / speed) * wgt;
      dz += (car.phys.vy / speed) * wgt;
    }
    const want = Math.atan2(dz, dx);
    const k = (rate: number) => (this.snapCam ? 1 : 1 - Math.exp(-rate * dt));
    this.camYaw += Phaser.Math.Angle.Wrap(want - this.camYaw) * k(this.camMode === 'hood' ? 12 : 4.5);
    const cy = Math.cos(this.camYaw);
    const sy = Math.sin(this.camYaw);

    const st = car.stats;
    const frac = Phaser.Math.Clamp(speed / (st.maxSpeed * st.boostSpeed), 0, 1);
    const fovWant = (this.camMode === 'high' ? 50 : 62) + (quality.low ? 0 : 16 * frac + this.fovKick);
    this.fov += (fovWant - this.fov) * k(this.fovKick > 1 ? 9 : 3);
    const base = this.carY;

    if (this.camMode === 'hood') {
      this.eye.set(car.x + Math.cos(h) * m.length * 0.05, base + m.width * 0.62 + 1.2, car.y + Math.sin(h) * m.length * 0.05);
      const lx = car.x + cy * 60, lz = car.y + sy * 60;
      this.camLook.set(lx, w.groundY(lx, lz) + 2, lz);
    } else {
      const [dist, height, ahead, lookH] = CAM_RIG[this.camMode];
      const back = dist + frac * 5;
      const tx = car.x - cy * back;
      const tz = car.y - sy * back;
      const far = Math.hypot(tx - this.eye.x, tz - this.eye.z) > 150;
      const kp = this.snapCam || far ? 1 : 1 - Math.exp(-10 * dt);
      this.eye.x += (tx - this.eye.x) * kp;
      this.eye.z += (tz - this.eye.z) * kp;
      this.eye.y += (base + height - this.eye.y) * kp;
      this.eye.y = Math.max(this.eye.y, w.groundY(this.eye.x, this.eye.z) + 3); // never inside a hill
      this.camLook.set(car.x + cy * ahead, base + lookH, car.y + sy * ahead);
    }
    this.snapCam = false;

    const c = this.cam3;
    c.position.copy(this.eye);
    let look = this.camLook;
    if (this.intro) {
      // Opening shot: high above the track, looking over it, then sweeping down behind the car before GO.
      const t = this.state === 'countdown' ? 1 - Math.max(0, this.countdown) / this.countdownFrom : 1;
      const e = ease(Phaser.Math.Clamp((t - 0.15) / 0.8, 0, 1));
      if (e >= 1) this.intro = false;
      c.position.lerpVectors(this.introEye, this.eye, e);
      c.position.y = this.introEye.y + (this.eye.y - this.introEye.y) * Math.pow(e, 0.6);
      this.tmp.set(w.center.x, 0, w.center.z).lerp(this.camLook, ease(e));
      look = this.tmp;
    }
    if (this.shakeLeft > 0 && this.shakePower > 0) {
      const a = this.shakePower * 140;
      c.position.x += (Math.random() - 0.5) * a;
      c.position.y += (Math.random() - 0.5) * a * 0.6;
      c.position.z += (Math.random() - 0.5) * a;
    }
    if (this.rumble3 > 0) c.position.y += Math.sin(this.time.now * 0.11) * 0.22 * this.rumble3;
    c.fov = this.fov;
    c.aspect = this.stage.aspect;
    c.updateProjectionMatrix();
    c.lookAt(look);
  }
}
