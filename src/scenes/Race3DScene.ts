import * as THREE from 'three';
import Phaser from 'phaser';
import { SceneKey } from '../game/config';
import { recordId } from '../game/dimension';
import { DRIFT_MIN_SPEED, DRIFT_SLIP } from '../game/carPhysics';
import { getCar } from '../game/cars';
import type { GhostRunner } from '../game/GhostRunner';
import { equippedPaint, equippedSmoke, selectedCar } from '../game/profile';
import { quality } from '../game/quality';
import { trackLayout, type BuiltTrack } from '../game/Track';
import { buildCar, type CarModel } from '../three/carModel';
import { Particles, SkidMarks, displayColor } from '../three/fx';
import { getStage, type Stage3D } from '../three/stage';
import { worldFor, type World3D } from '../three/world';
import type { Spawn } from './DriveScene';
import { RaceScene } from './RaceScene';

type CamMode = 'chase' | 'far' | 'hood' | 'high';
const CAM_MODES: CamMode[] = ['chase', 'far', 'hood', 'high'];
const CAM_LABEL: Record<CamMode, string> = { chase: 'CHASE CAM', far: 'FAR CHASE CAM', hood: 'BONNET CAM', high: 'HIGH CAM' };
/** Distance behind, height, look-ahead and look height of each follow camera (world units = 2D pixels). */
const CAM_RIG: Record<Exclude<CamMode, 'hood'>, [number, number, number, number]> = {
  chase: [30, 10, 16, 3],
  far: [52, 21, 24, 2],
  high: [55, 90, 14, 0],
};
const CAM_KEY = 'oversteer.cam3d';

const loadCam = (): CamMode => {
  try {
    const m = localStorage.getItem(CAM_KEY) as CamMode | null;
    return m && CAM_MODES.includes(m) ? m : 'chase';
  } catch {
    return 'chase';
  }
};

/**
 * A circuit race in 3D. All of the racing is RaceScene's (and DriveScene's): the same car physics, laps, timing,
 * coins, drift chains, boost pads, ghosts, pause and results, so the 3D game plays exactly like the 2D one. Only
 * the picture changes: the 2D world camera is switched off and three.js draws the track and the car from behind,
 * under Phaser's HUD. Records, ghosts and leaderboards are the 3D game's own (`3d:` ids, see dimension.ts).
 */
export class Race3DScene extends RaceScene {
  private stage!: Stage3D;
  private world!: World3D;
  private readonly cam3 = new THREE.PerspectiveCamera(64, 16 / 9, 0.5, 6000);
  private model!: CarModel;
  private ghosts = new Map<GhostRunner, CarModel>();
  private smoke3!: Particles;
  private flame3!: Particles;
  private skids3!: SkidMarks;
  private blob!: THREE.Mesh;
  private camMode: CamMode = 'chase';
  private camYaw = 0;
  private fov = 64;
  private readonly eye = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private snapCam = true;
  private lastHeading = 0;
  private lastSpeed = 0;
  private steerVis = 0;
  private roll = 0;
  private pitch = 0;
  private rolled = 0;
  private shakeLeft = 0;
  private shakePower = 0;
  private lastSkid: Array<{ x: number; z: number } | null> = [null, null];
  private smokeColors: THREE.Color[] = [];
  private readonly tmp = new THREE.Vector3();
  private readonly buf = new THREE.Vector2();
  private readonly dustColor = displayColor(0xa78a5a);
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
    this.model = buildCar(def, equippedPaint().color ?? def.color);
    const g = this.world.runGroup;
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
    g.add(this.skids3.mesh, this.smoke3.points, this.flame3.points);
    const tint = equippedSmoke().tint;
    this.smokeColors = (Array.isArray(tint) ? tint : [tint]).map(displayColor);

    this.camMode = loadCam();
    this.snapCam = true;
    this.lastHeading = this.car.facing;
    this.lastSpeed = 0;
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
    this.blob.geometry.dispose();
    const bm = this.blob.material as THREE.MeshBasicMaterial;
    bm.map?.dispose();
    bm.dispose();
    this.world.flameLight.intensity = 0;
  }

  private cycleCamera(): void {
    this.camMode = CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length];
    this.snapCam = true;
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

    // body roll, pitch and steering, from what the physics did this frame
    if (dt > 0) {
      const dh = Phaser.Math.Angle.Wrap(h - this.lastHeading);
      const turning = speed > 5 ? Phaser.Math.Clamp(dh / (Math.max(0.1, ph.stats.turnRate) * dt), -1, 1) : 0;
      const ease = (k: number) => 1 - Math.exp(-k * dt);
      this.steerVis += (turning - this.steerVis) * ease(12);
      const lateral = ph.vx * -sin + ph.vy * cos;
      this.roll += (Phaser.Math.Clamp((lateral / ph.stats.maxSpeed) * 0.3, -0.09, 0.09) - this.roll) * ease(8);
      const accel = (speed - this.lastSpeed) / dt;
      this.pitch += (Phaser.Math.Clamp(accel * 0.00035, -0.05, 0.05) - this.pitch) * ease(6);
      this.rolled += (ph.vx * cos + ph.vy * sin) * dt;
    }
    this.lastHeading = h;
    this.lastSpeed = speed;
    m.root.position.set(car.x, 0, car.y);
    m.root.rotation.y = -h;
    const bump = car.offRoad && speed > 20 && dt > 0 ? (Math.random() - 0.5) * 0.35 : 0;
    m.body.position.y = bump;
    m.body.rotation.set(this.roll, 0, this.pitch);
    m.wheels.forEach((w) => { w.rotation.z = -this.rolled / m.radius; });
    m.steer.forEach((s) => { s.rotation.y = -this.steerVis * 0.42; });
    m.root.updateMatrixWorld();

    this.updateGhosts();
    if (dt > 0) this.effects3D(dt);
    this.updateCamera3D(dt);

    // lights the car carries
    const w = this.world;
    if (this.wasBoosting && dt > 0) {
      this.tmp.copy(m.exhaust).applyMatrix4(m.root.matrixWorld);
      w.flameLight.position.copy(this.tmp);
      w.flameLight.intensity = 3 + Math.random() * 2;
    } else w.flameLight.intensity = 0;
    if (w.headlight) {
      w.headlight.position.set(car.x + cos * m.length * 0.5, 4, car.y + sin * m.length * 0.5);
      w.headlight.target.position.set(car.x + cos * 70, 0, car.y + sin * 70);
    }
    w.update(dt, car.x, car.y, quality.low);

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
        gm = buildCar(getCar(run.data.carId), run.sprite.tintTopLeft, true);
        this.world.runGroup.add(gm.root);
        this.ghosts.set(run, gm);
      }
      gm.root.visible = run.sprite.visible;
      gm.root.position.set(run.sprite.x, 0, run.sprite.y);
      gm.root.rotation.y = -run.sprite.rotation;
    }
  }

  private effects3D(dt: number): void {
    const car = this.car;
    const m = this.model;
    const speed = car.speed;
    const slip = this.surface.zone ? car.phys.rawSlip : car.slip;
    const sliding = !car.offRoad && slip > DRIFT_SLIP && speed > DRIFT_MIN_SPEED;
    const fx = !quality.low;
    const rear = -m.length * 0.32;
    for (let k = 0; k < 2; k++) {
      const side = (k === 0 ? -1 : 1) * m.width * 0.4;
      const p = car.point(rear, side);
      if (sliding) {
        const last = this.lastSkid[k];
        if (last && Math.hypot(p.x - last.x, p.y - last.z) < 30) this.skids3.add(last.x, last.z, p.x, p.y, 1.4);
        this.lastSkid[k] = { x: p.x, z: p.y };
        if (fx) {
          const c = this.smokeColors[Math.floor(Math.random() * this.smokeColors.length)];
          this.smoke3.emit(p.x, 0.8, p.y, (Math.random() - 0.5) * 8, 2 + Math.random() * 3, (Math.random() - 0.5) * 8, 0.9 + Math.random() * 0.4, 2.5, 11 + slip * 10, c, 0.5);
        }
      } else this.lastSkid[k] = null;
    }
    if (car.offRoad && speed > 25 && fx) {
      const p = car.point(-m.length * 0.5, 0);
      this.smoke3.emit(p.x, 0.6, p.y, (Math.random() - 0.5) * 14, 4 + Math.random() * 4, (Math.random() - 0.5) * 14, 0.6, 2, 8, this.dustColor, 0.6);
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
    if (this.shakeLeft > 0) {
      this.shakeLeft -= dt;
      if (this.shakeLeft <= 0) this.shakePower = 0;
    }
  }

  private updateCamera3D(dt: number): void {
    const car = this.car;
    const m = this.model;
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
    const fovWant = (this.camMode === 'high' ? 50 : 62) + (quality.low ? 0 : 16 * frac);
    this.fov += (fovWant - this.fov) * k(3);

    if (this.camMode === 'hood') {
      this.eye.set(car.x + Math.cos(h) * m.length * 0.05, m.width * 0.62 + 1.2, car.y + Math.sin(h) * m.length * 0.05);
      this.camLook.set(car.x + cy * 60, 2, car.y + sy * 60);
    } else {
      const [dist, height, ahead, lookH] = CAM_RIG[this.camMode];
      const back = dist + frac * 5;
      const tx = car.x - cy * back;
      const tz = car.y - sy * back;
      const far = Math.hypot(tx - this.eye.x, tz - this.eye.z) > 150;
      const kp = this.snapCam || far ? 1 : 1 - Math.exp(-10 * dt);
      this.eye.x += (tx - this.eye.x) * kp;
      this.eye.z += (tz - this.eye.z) * kp;
      this.eye.y += (height - this.eye.y) * kp;
      this.camLook.set(car.x + cy * ahead, lookH, car.y + sy * ahead);
    }
    this.snapCam = false;

    const c = this.cam3;
    c.position.copy(this.eye);
    if (this.shakeLeft > 0 && this.shakePower > 0) {
      const a = this.shakePower * 140;
      c.position.x += (Math.random() - 0.5) * a;
      c.position.y += (Math.random() - 0.5) * a * 0.6;
      c.position.z += (Math.random() - 0.5) * a;
    }
    c.fov = this.fov;
    c.aspect = this.stage.aspect;
    c.updateProjectionMatrix();
    c.lookAt(this.camLook);
  }
}
