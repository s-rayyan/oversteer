import * as THREE from 'three';

/**
 * A pool of soft round particles (tyre smoke, dust, boost flame) drawn as one batch of points, so a whole cloud of
 * smoke costs a single draw call. Colours are given in display (sRGB) values and drawn as they are.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly color: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly grow: Float32Array; // [start size, end size]
  private readonly a0: Float32Array;
  private next = 0;
  private readonly mat: THREE.ShaderMaterial;
  private live = 0;

  constructor(private readonly cap: number, additive: boolean, private readonly rise = 4, private readonly drag = 1.6) {
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.color = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.maxLife = new Float32Array(cap);
    this.grow = new Float32Array(cap * 2);
    this.a0 = new Float32Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uMap: { value: softDot() } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        uniform float uScale; varying float vAlpha; varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.5);
          vAlpha = aAlpha; vColor = aColor;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; varying float vAlpha; varying vec3 vColor;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: THREE.Color, alpha: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.color.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i * 2] = s0;
    this.grow[i * 2 + 1] = s1;
    this.a0[i] = alpha;
    this.size[i] = s0;
    this.alpha[i] = alpha;
    this.live = this.cap;
  }

  /** `scale`: the screen height in pixels over 2 tan(fov / 2), so sizes are in world units. */
  update(dt: number, scale: number): void {
    this.mat.uniforms.uScale.value = scale;
    if (!this.live) return;
    let any = false;
    const k = Math.exp(-this.drag * dt);
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const j = i * 3;
      this.vel[j] *= k;
      this.vel[j + 2] *= k;
      this.vel[j + 1] = this.vel[j + 1] * k + this.rise * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = this.grow[i * 2] + (this.grow[i * 2 + 1] - this.grow[i * 2]) * t;
      this.alpha[i] = this.life[i] > 0 ? this.a0[i] * (1 - t) : 0;
    }
    if (!any) this.live = 0;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.mat.uniforms.uMap.value as THREE.Texture).dispose();
    this.mat.dispose();
  }
}

/** A colour for Particles.emit, given as it should look on screen. */
export function displayColor(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);
}

export function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/**
 * Tyre marks: dark strips laid on the road behind the rear wheels while sliding, kept in a ring so the oldest
 * ones are reused (one instanced mesh, one draw call).
 */
export class SkidMarks {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly cap = 1600) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0b0a10, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
  }

  /** A strip from (x0, z0) to (x1, z1) on the road, whose surface is at height `y`. */
  add(x0: number, z0: number, x1: number, z1: number, width: number, y = 0): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.05) return;
    this.q.setFromAxisAngle(this.up, -Math.atan2(z1 - z0, x1 - x0));
    this.v.set((x0 + x1) / 2, y + 0.2, (z0 + z1) / 2);
    this.s.set(len + 0.3, 1, width);
    this.m.compose(this.v, this.q, this.s);
    this.mesh.setMatrixAt(this.next, this.m);
    this.next = (this.next + 1) % this.cap;
    this.mesh.count = Math.max(this.mesh.count, this.next === 0 ? this.cap : this.next);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/**
 * Weather round the camera: snow, blowing dust or rain. A fixed set of flakes (or drops) lives in a box that
 * follows the camera, wrapping round as it moves, so it costs the same however far you drive.
 */
export class Weather {
  readonly obj: THREE.Points | THREE.LineSegments;
  private readonly p: Float32Array; // x, y, z per particle
  private readonly v: Float32Array; // fall (or wind) speed and sway phase per particle
  private readonly verts: Float32Array;
  private t = 0;
  private readonly box: number;
  private readonly lo: number;
  private readonly hi: number;

  constructor(private readonly kind: 'snow' | 'dust' | 'rain', private readonly count: number, x: number, y: number, z: number) {
    const r = Math.random;
    this.box = kind === 'rain' ? 200 : kind === 'dust' ? 260 : 280;
    this.lo = kind === 'dust' ? 22 : 50;
    this.hi = kind === 'dust' ? 4 : 90;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      this.p[i * 3] = x + (r() - 0.5) * this.box;
      this.p[i * 3 + 1] = y - this.lo + r() * (this.lo + this.hi);
      this.p[i * 3 + 2] = z + (r() - 0.5) * this.box;
      this.v[i * 2] = kind === 'rain' ? 200 + r() * 60 : kind === 'dust' ? 45 + r() * 35 : 7 + r() * 7;
      this.v[i * 2 + 1] = r() * Math.PI * 2;
    }
    const g = new THREE.BufferGeometry();
    if (kind === 'rain') {
      this.verts = new Float32Array(count * 6);
      g.setAttribute('position', new THREE.BufferAttribute(this.verts, 3).setUsage(THREE.DynamicDrawUsage));
      this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9d6e3, transparent: true, opacity: 0.45, depthWrite: false }));
    } else {
      this.verts = this.p;
      g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
      this.obj = new THREE.Points(g, new THREE.PointsMaterial({
        map: softDot(), size: kind === 'dust' ? 5 : 1.5, transparent: true, depthWrite: false,
        color: kind === 'dust' ? 0xd9b98a : 0xffffff, opacity: kind === 'dust' ? 0.32 : 0.9,
      }));
    }
    this.obj.frustumCulled = false;
    this.obj.renderOrder = 4;
  }

  update(dt: number, cx: number, cy: number, cz: number): void {
    this.t += dt;
    const b = this.box;
    const wrap = (v: number, c: number) => c + ((((v - c + b / 2) % b) + b) % b) - b / 2;
    const span = this.lo + this.hi;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      const speed = this.v[i * 2];
      const ph = this.v[i * 2 + 1];
      if (this.kind === 'dust') {
        this.p[j] += speed * dt;
        this.p[j + 1] += Math.sin(this.t * 1.3 + ph) * 3 * dt;
        this.p[j + 2] += speed * 0.35 * dt;
      } else {
        this.p[j + 1] -= speed * dt;
        const sway = this.kind === 'snow' ? 4 : 0;
        this.p[j] += (Math.sin(this.t * 0.9 + ph) * sway + (this.kind === 'rain' ? 18 : 2)) * dt;
        this.p[j + 2] += Math.cos(this.t * 0.7 + ph) * sway * dt;
      }
      this.p[j] = wrap(this.p[j], cx);
      this.p[j + 2] = wrap(this.p[j + 2], cz);
      let y = this.p[j + 1] - (cy - this.lo);
      y = ((y % span) + span) % span;
      this.p[j + 1] = cy - this.lo + y;
      if (this.kind === 'rain') {
        const k = i * 6;
        this.verts[k] = this.p[j]; this.verts[k + 1] = this.p[j + 1]; this.verts[k + 2] = this.p[j + 2];
        this.verts[k + 3] = this.p[j] - 0.5; this.verts[k + 4] = this.p[j + 1] + 5; this.verts[k + 5] = this.p[j + 2];
      }
    }
    this.obj.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.obj.geometry.dispose();
    const m = this.obj.material as THREE.PointsMaterial;
    m.map?.dispose();
    m.dispose();
  }
}
