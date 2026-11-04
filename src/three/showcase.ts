import * as THREE from 'three';
import type Phaser from 'phaser';
import type { CarDef } from '../game/cars';
import { GAME_HEIGHT, GAME_WIDTH } from '../game/config';
import { buildCar, type CarModel } from './carModel';
import { getStage, type Stage3D } from './stage';

/**
 * A 3D car slowly turning on a turntable, drawn into a rectangle of the screen (in game pixels) under a Phaser
 * scene, for the 3D game's garage and paint shop. The rest of the 3D canvas is cleared to the game's background
 * colour, so the scene's own text and panels look just as they do in 2D.
 */
export class Showcase {
  private readonly stage: Stage3D;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.PerspectiveCamera(30, 1, 1, 500);
  private model: CarModel | null = null;
  private key = '';
  private angle = -0.6;
  private readonly size = new THREE.Vector2();
  private readonly turntable: THREE.Mesh;
  private readonly ring: THREE.Mesh;

  constructor(game: Phaser.Game, private readonly rect: { x: number; y: number; w: number; h: number }) {
    this.stage = getStage(game);
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x2a2838, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(-30, 60, 40);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9ad1ff, 1.2);
    rim.position.set(40, 20, -50);
    this.scene.add(rim);
    this.turntable = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 0.8, 40),
      new THREE.MeshLambertMaterial({ color: 0x2b2d42 }),
    );
    this.turntable.position.y = -0.4;
    this.scene.add(this.turntable);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    this.ring.rotation.x = Math.PI / 2;
    this.scene.add(this.ring);
    this.stage.show(true);
  }

  /** Shows this car in this colour (rebuilt only when either changes). */
  setCar(def: CarDef, color: number): void {
    const key = `${def.id}:${color}`;
    if (key === this.key) return;
    this.key = key;
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
    }
    this.model = buildCar(def, color);
    this.scene.add(this.model.root);
    // frame the car whatever its size
    const r = Math.max(this.model.length, this.model.width * 1.6);
    const disc = r * 0.6;
    this.turntable.scale.set(disc, 1, disc);
    this.ring.scale.set(disc, disc, disc);
    this.cam.position.set(0, r * 0.8, r * 1.75);
    this.cam.lookAt(0, 1.5, 0);
  }

  update(delta: number): void {
    if (!this.model) return;
    this.angle += (delta / 1000) * 0.7;
    this.model.root.rotation.y = this.angle;
    this.model.wheels.forEach((w) => { w.rotation.z = 0; });
    const st = this.stage;
    st.show(true); // (again each frame: a scene closing late may have hidden the shared canvas)
    const r = st.renderer;
    r.getSize(this.size);
    const s = this.size.x / GAME_WIDTH;
    const { x, y, w, h } = this.rect;
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.x, this.size.y);
    r.setClearColor(0x14121f, 1);
    r.clear();
    const vx = x * s, vy = (GAME_HEIGHT - y - h) * s, vw = w * s, vh = h * s;
    r.setViewport(vx, vy, vw, vh);
    r.setScissor(vx, vy, vw, vh);
    r.setScissorTest(true);
    this.cam.aspect = vw / vh;
    this.cam.updateProjectionMatrix();
    r.render(this.scene, this.cam);
    r.setScissorTest(false);
    r.setViewport(0, 0, this.size.x, this.size.y);
  }

  destroy(): void {
    this.stage.show(false);
    this.model?.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material && !Array.isArray(m.material)) m.material.dispose();
    });
  }
}
