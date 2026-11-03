import * as THREE from 'three';
import { KERB, type RoadPt } from '../game/Track';
import type { Theme, TrackDef } from '../game/tracks';

// The 3D world of a circuit, built from the very same road samples the 2D game drives on (1 world unit = 1 px of
// the 2D map; the 2D map's x/y become the ground's x/z). Everything is generated in code, like the rest of the game:
// no model or texture files. Built once per track and kept while the same track is raced again (R).

const ROAD_Y = 0.12;
const KERB_TOP = 0.55;

interface ThemeLook {
  skyTop: number;
  skyLow: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sun: number;
  sunColor: number;
  ground: [number, number, number]; // base, light, dark
  asphalt: number;
  hills: number;
  cap: number | null;
}

const LOOK: Record<Theme, ThemeLook> = {
  grass: {
    skyTop: 0x3f8fd8, skyLow: 0xcfe8f5, fog: 0xc4e0ee, fogNear: 600, fogFar: 3400, hemiSky: 0xcfe9ff, hemiGround: 0x3a6b4f,
    hemi: 1.5, sun: 2.6, sunColor: 0xfff1d6, ground: [0x2d6a4f, 0x40916c, 0x245c43], asphalt: 0x4a4e6a, hills: 0x4f7d5e, cap: null,
  },
  desert: {
    skyTop: 0x3d86c6, skyLow: 0xf6dcb0, fog: 0xf0d9b2, fogNear: 600, fogFar: 3400, hemiSky: 0xffe9c7, hemiGround: 0xb38a4f,
    hemi: 1.5, sun: 3.0, sunColor: 0xffe2b0, ground: [0xd4a762, 0xe3bb7e, 0xbf9150], asphalt: 0x4d4b5e, hills: 0xb5653a, cap: null,
  },
  snow: {
    skyTop: 0x7f9fbd, skyLow: 0xe3edf3, fog: 0xdbe6ed, fogNear: 400, fogFar: 2800, hemiSky: 0xe8f3ff, hemiGround: 0x9fb4c2,
    hemi: 1.7, sun: 1.9, sunColor: 0xf2f6ff, ground: [0xe8f1f5, 0xffffff, 0xc9dde6], asphalt: 0x4a4e66, hills: 0x6f7d8a, cap: 0xf4f8fb,
  },
  night: {
    skyTop: 0x07061a, skyLow: 0x2a2350, fog: 0x15132c, fogNear: 300, fogFar: 2600, hemiSky: 0x5a64b8, hemiGround: 0x101820,
    hemi: 0.55, sun: 0.5, sunColor: 0x9fb4ff, ground: [0x1b3a2f, 0x25503f, 0x142b23], asphalt: 0x3a3d55, hills: 0x17152e, cap: null,
  },
};

const GRAVEL = 0x8a7550;
const DRIFT_ZONE = 0x454a8c;

// ---------- small helpers ----------

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic random numbers (mulberry32), so a track looks the same every time. */
export function rng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, pixel = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (pixel) t.magFilter = THREE.NearestFilter;
  t.anisotropy = 4;
  return t;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Fast "is this point on (or within `margin` of) the road" lookups, via a grid of road samples. */
export class RoadGrid {
  private readonly cell = 48;
  private readonly cells = new Map<number, number[]>();
  private readonly maxHalf: number;

  constructor(private readonly pts: RoadPt[]) {
    this.maxHalf = Math.max(...pts.map((p) => p.half));
    pts.forEach((p, i) => {
      const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(i);
    });
  }

  private key(cx: number, cy: number): number {
    return (cx + 2048) * 4096 + (cy + 2048);
  }

  /** True when (x, y) is closer than `margin` past the edge of any part of the road. */
  near(x: number, y: number, margin: number): boolean {
    const reach = this.maxHalf + Math.max(0, margin);
    const r = Math.ceil(reach / this.cell);
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cy - r; j <= cy + r; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const s of list) {
          const p = this.pts[s];
          const d = p.half + margin;
          if (d > 0 && (p.x - x) ** 2 + (p.y - y) ** 2 < d * d) return true;
        }
      }
    }
    return false;
  }
}

/** Unit tangent (along the road) and normal (to its right, in 2D map axes) at every sample. */
function frames(pts: RoadPt[]): { tx: number; ty: number; nx: number; ny: number }[] {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    return { tx, ty, nx: -ty, ny: tx };
  });
}

/** Collects triangles with per-vertex colours and UVs into one BufferGeometry. */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  private c = new THREE.Color();

  /**
   * Quad a-b-c-d, each [x, y(height), z, u, v]: a and b along one edge (in driving order), d and c along the edge
   * to its right, so the face points up.
   */
  quad(a: number[], b: number[], c: number[], d: number[], color: number): void {
    this.c.setHex(color);
    for (const v of [a, c, b, a, d, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.uv.push(v[3] ?? 0, v[4] ?? 0);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return g;
  }
}

// ---------- props (trees, rocks...) as instanced meshes ----------

interface Part {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  local: THREE.Matrix4;
}

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1): THREE.Matrix4 => {
  const sc = Array.isArray(s) ? new THREE.Vector3(...s) : new THREE.Vector3(s, s, s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), sc);
};

function propKinds(theme: Theme): { name: string; weight: number; radius: number; parts: Part[] }[] {
  const night = theme === 'night';
  const trunk = lambert(night ? 0x3b2616 : 0x6b4226);
  const trunkGeo = new THREE.CylinderGeometry(1.1, 1.5, 8, 6);
  const rockMat = lambert(theme === 'desert' ? 0xa8743a : theme === 'snow' ? 0xaeb9c3 : night ? 0x454d5a : 0x868e99);
  const rockGeo = new THREE.DodecahedronGeometry(3, 0);
  const rock = { name: 'rock', weight: 0.12, radius: 4, parts: [{ geo: rockGeo, mat: rockMat, local: at(0, 1, 0, 0, 0, 0, [1, 0.65, 1]) }] };
  const boulder = { name: 'boulder', weight: 0.05, radius: 10, parts: [{ geo: rockGeo, mat: rockMat, local: at(0, 2.5, 0, 0.3, 0, 0.2, [2.8, 1.8, 2.4]) }] };
  if (theme === 'desert') {
    const green = lambert(0x2d8a4e);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 7);
    const cactus: Part[] = [
      { geo: cyl, mat: green, local: at(0, 8, 0, 0, 0, 0, [1.7, 16, 1.7]) },
      { geo: cyl, mat: green, local: at(2.4, 6, 0, 0, 0, Math.PI / 2, [1.1, 3.4, 1.1]) },
      { geo: cyl, mat: green, local: at(3.8, 9, 0, 0, 0, 0, [1.1, 6.5, 1.1]) },
      { geo: cyl, mat: green, local: at(-2.2, 9, 0, 0, 0, Math.PI / 2, [1, 3, 1]) },
      { geo: cyl, mat: green, local: at(-3.5, 11.5, 0, 0, 0, 0, [1, 5.5, 1]) },
    ];
    const dry = lambert(0x9c7a3f);
    const bushGeo = new THREE.IcosahedronGeometry(3, 0);
    return [
      { name: 'cactus', weight: 0.5, radius: 5, parts: cactus },
      { name: 'bush', weight: 0.25, radius: 4, parts: [{ geo: bushGeo, mat: dry, local: at(0, 1.6, 0, 0, 0, 0, [1, 0.6, 1]) }] },
      rock,
      boulder,
    ];
  }
  if (theme === 'snow') {
    const pineMat = lambert(0x1f5a3d);
    const white = lambert(0xf4f8fb);
    return [
      {
        name: 'pine', weight: 0.6, radius: 7, parts: [
          { geo: trunkGeo, mat: trunk, local: at(0, 2.5, 0, 0, 0, 0, [0.8, 0.6, 0.8]) },
          { geo: new THREE.ConeGeometry(7, 13, 7), mat: pineMat, local: at(0, 10, 0) },
          { geo: new THREE.ConeGeometry(5, 9, 7), mat: pineMat, local: at(0, 16, 0) },
          { geo: new THREE.ConeGeometry(3, 5.4, 7), mat: white, local: at(0, 19.6, 0) },
        ],
      },
      { name: 'drift', weight: 0.2, radius: 5, parts: [{ geo: new THREE.IcosahedronGeometry(3.5, 0), mat: white, local: at(0, 0.8, 0, 0, 0, 0, [1.4, 0.5, 1]) }] },
      rock,
      boulder,
    ];
  }
  const crownA = lambert(night ? 0x143d2b : 0x2d8a5a);
  const crownB = lambert(night ? 0x1d5a40 : 0x40916c);
  const pineMat = lambert(night ? 0x10301f : 0x1f5a3d);
  return [
    {
      name: 'oak', weight: 0.42, radius: 8, parts: [
        { geo: trunkGeo, mat: trunk, local: at(0, 4, 0) },
        { geo: new THREE.IcosahedronGeometry(7, 0), mat: crownA, local: at(0, 13, 0) },
        { geo: new THREE.IcosahedronGeometry(4.5, 0), mat: crownB, local: at(2.5, 16, 1.5) },
      ],
    },
    {
      name: 'pine', weight: 0.28, radius: 6, parts: [
        { geo: trunkGeo, mat: trunk, local: at(0, 2.5, 0, 0, 0, 0, [0.8, 0.6, 0.8]) },
        { geo: new THREE.ConeGeometry(6, 17, 7), mat: pineMat, local: at(0, 13, 0) },
      ],
    },
    { name: 'bush', weight: 0.2, radius: 4, parts: [{ geo: new THREE.IcosahedronGeometry(3.5, 0), mat: crownB, local: at(0, 2, 0, 0, 0, 0, [1, 0.7, 1]) }] },
    rock,
  ];
}

function instanced(parts: Part[], placements: THREE.Matrix4[], shadows: boolean): THREE.InstancedMesh[] {
  if (!placements.length) return [];
  const m = new THREE.Matrix4();
  return parts.map((p) => {
    const mesh = new THREE.InstancedMesh(p.geo, p.mat, placements.length);
    placements.forEach((pl, i) => mesh.setMatrixAt(i, m.multiplyMatrices(pl, p.local)));
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return mesh;
  });
}

// ---------- the world ----------

export class World3D {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly look: ThemeLook;
  readonly night: boolean;
  /** Everything belonging to one run (car, ghosts, effects) goes here and is cleared when the run ends. */
  readonly runGroup = new THREE.Group();
  readonly grid: RoadGrid;
  /** Lights the car carries, kept in the world for good (adding or removing a light recompiles every material). */
  readonly flameLight = new THREE.PointLight(0xff8a3d, 0, 45, 0);
  readonly headlight: THREE.SpotLight | null;
  private readonly padTextures: THREE.Texture[] = [];

  constructor(readonly def: TrackDef, readonly samples: RoadPt[]) {
    this.look = LOOK[def.theme];
    this.night = def.theme === 'night';
    this.grid = new RoadGrid(samples);
    const L = this.look;

    // Sky: a vertical gradient behind everything, and fog in the same colour as the horizon.
    this.scene.background = canvasTexture(4, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, hex(L.skyTop));
      g.addColorStop(0.62, hex(L.skyLow));
      g.addColorStop(1, hex(L.fog));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
    }, false);
    this.scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);

    this.scene.add(new THREE.HemisphereLight(L.hemiSky, L.hemiGround, L.hemi));
    this.sun = new THREE.DirectionalLight(L.sunColor, L.sun);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.flameLight);
    this.headlight = this.night ? new THREE.SpotLight(0xfff1d0, 3.4, 200, 0.5, 0.55, 0) : null;
    if (this.headlight) this.scene.add(this.headlight, this.headlight.target);

    const xs = samples.map((p) => p.x);
    const ys = samples.map((p) => p.y);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const span = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    const rand = rng(def.id);

    this.buildGround(cx, cy, span);
    this.buildRoad();
    this.buildPads();
    this.buildStart();
    this.buildProps(box, rand);
    this.buildHorizon(cx, cy, span, rand);
    if (this.night) this.buildLamps();
    this.scene.add(this.runGroup);
  }

  private buildGround(cx: number, cy: number, span: number): void {
    const [base, light, dark] = this.look.ground;
    const tex = canvasTexture(32, 32, (ctx) => {
      ctx.fillStyle = hex(base);
      ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = hex(light);
      [[3, 4], [20, 9], [11, 22], [27, 26], [6, 14], [16, 2]].forEach(([x, y]) => ctx.fillRect(x, y, 2, 2));
      ctx.fillStyle = hex(dark);
      [[8, 8], [24, 18], [14, 28], [29, 5], [2, 24]].forEach(([x, y]) => ctx.fillRect(x, y, 2, 1));
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const size = span + 9000;
    tex.repeat.set(size / 40, size / 40);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cy);
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private buildRoad(): void {
    const pts = this.samples;
    const n = pts.length;
    const fr = frames(pts);
    const road = new Builder();
    const kerb = new Builder();
    const marks = new Builder();
    let dist = 0;
    const edge = (i: number, off: number, h: number, u: number, v: number) => [pts[i].x + fr[i].nx * off, h, pts[i].y + fr[i].ny * off, u, v];
    // A raised kerb only rises where it isn't lying on another stretch of road (tight hairpins fold their inside
    // kerb over the road, and a kerb poking up through the asphalt would look broken).
    const kerbH = (i: number, off: number) => (this.grid.near(pts[i].x + fr[i].nx * off, pts[i].y + fr[i].ny * off, -1) ? ROAD_Y - 0.05 : KERB_TOP);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = pts[i];
      const b = pts[j];
      const step = Math.hypot(b.x - a.x, b.y - a.y);
      const v0 = dist / 48;
      const v1 = (dist + step) / 48;
      dist += step;
      const color = a.rough ? GRAVEL : a.zone ? DRIFT_ZONE : this.look.asphalt;
      road.quad(edge(i, -a.half, ROAD_Y, 0, v0), edge(j, -b.half, ROAD_Y, 0, v1), edge(j, b.half, ROAD_Y, 1, v1), edge(i, a.half, ROAD_Y, 1, v0), color);
      const stripe = Math.floor(i / 3) % 2 === 1;
      const kc = stripe ? 0xf1faee : a.zone ? 0x4895ef : 0xe63946;
      for (const side of [-1, 1]) {
        const ia = side * a.half, ib = side * b.half;
        const oa = side * (a.half + KERB), ob = side * (b.half + KERB);
        const ha = kerbH(i, oa), hb = kerbH(j, ob);
        // kerb: from the road edge up to its raised outer edge, then a dark lip down to the ground (left-hand
        // ones are given outer edge first, so every face points up)
        const q = (in0: number[], in1: number[], out1: number[], out0: number[], c: number) =>
          (side > 0 ? kerb.quad(in0, in1, out1, out0, c) : kerb.quad(out0, out1, in1, in0, c));
        q(edge(i, ia, ROAD_Y, 0, 0), edge(j, ib, ROAD_Y, 0, 0), edge(j, ob, hb, 0, 0), edge(i, oa, ha, 0, 0), kc);
        q(edge(i, oa, ha, 0, 0), edge(j, ob, hb, 0, 0), edge(j, ob + side * 1.2, 0.02, 0, 0), edge(i, oa + side * 1.2, 0.02, 0, 0), 0x2a2838);
      }
      // dashed centre line (none on gravel)
      if (!a.rough && Math.floor(i / 4) % 2 === 0) {
        const mc = a.zone ? 0x9ad1ff : 0xe9c46a;
        const y = ROAD_Y + 0.03;
        marks.quad(edge(i, -0.8, y, 0, 0), edge(j, -0.8, y, 0, 0), edge(j, 0.8, y, 0, 0), edge(i, 0.8, y, 0, 0), mc);
      }
    }
    const grain = canvasTexture(64, 64, (ctx) => {
      const r = rng(`${this.def.id}-grain`);
      ctx.fillStyle = '#e6e6e6';
      ctx.fillRect(0, 0, 64, 64);
      for (let k = 0; k < 900; k++) {
        const v = 200 + Math.floor(r() * 55);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 1, 1);
      }
      // worn tyre lanes
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(14, 0, 6, 64);
      ctx.fillRect(44, 0, 6, 64);
    });
    grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
    const roadMesh = new THREE.Mesh(road.geometry(), new THREE.MeshLambertMaterial({ map: grain, vertexColors: true }));
    roadMesh.receiveShadow = true;
    const kerbMesh = new THREE.Mesh(kerb.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    kerbMesh.receiveShadow = true;
    const markMesh = new THREE.Mesh(marks.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    markMesh.receiveShadow = true;
    this.scene.add(kerbMesh, roadMesh, markMesh);
  }

  /** Boost pads: dark strips with yellow chevrons that scroll along the road. */
  private buildPads(): void {
    const pts = this.samples;
    const n = pts.length;
    const fr = frames(pts);
    // A chevron with its point at the top of the picture, which is the far end (+v) of the strip: the way you drive.
    const tex = canvasTexture(32, 32, (ctx) => {
      ctx.fillStyle = '#1d1b2e';
      ctx.fillRect(0, 0, 32, 32);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(3, 27);
      ctx.lineTo(16, 9);
      ctx.lineTo(29, 27);
      ctx.stroke();
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.padTextures.push(tex);
    const b = new Builder();
    let found = false;
    for (let i = 0; i < n; i++) {
      if (!pts[i].pad) continue;
      const j = (i + 1) % n;
      if (!pts[j].pad) continue;
      found = true;
      const w = pts[i].half * 0.75;
      const y = ROAD_Y + 0.04;
      const v0 = i / 3.3, v1 = (i + 1) / 3.3;
      const e = (k: number, off: number, u: number, v: number) => [pts[k].x + fr[k].nx * off, y, pts[k].y + fr[k].ny * off, u, v];
      b.quad(e(i, -w, 0, v0), e(j, -w, 0, v1), e(j, w, 1, v1), e(i, w, 1, v0), 0xffffff);
    }
    if (!found) return;
    const mesh = new THREE.Mesh(b.geometry(), new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.scene.add(mesh);
  }

  /** Checkered start line and a gantry over it. */
  private buildStart(): void {
    const p = this.samples[0];
    const f = frames(this.samples)[0];
    const half = p.half;
    const checker = canvasTexture(16, 2, (ctx) => {
      for (let c = 0; c < 16; c++) for (let r = 0; r < 2; r++) {
        ctx.fillStyle = (c + r) % 2 ? '#ffffff' : '#14121f';
        ctx.fillRect(c, r, 1, 1);
      }
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 8), new THREE.MeshLambertMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    line.rotation.x = -Math.PI / 2;
    const yaw = -Math.atan2(f.ty, f.tx);
    const holder = new THREE.Group();
    holder.position.set(p.x, ROAD_Y + 0.05, p.y);
    holder.rotation.y = yaw;
    // the plane's width runs along local x, which must lie across the road (local z after the yaw)
    line.rotation.z = Math.PI / 2;
    line.receiveShadow = true;
    holder.add(line);

    const postMat = lambert(0x2b2d42);
    const span = half + KERB + 5;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(2.4, 28, 2.4), postMat);
      post.position.set(0, 14, side * span);
      post.castShadow = true;
      holder.add(post);
    }
    const banner = canvasTexture(256, 32, (ctx) => {
      ctx.fillStyle = '#14121f';
      ctx.fillRect(0, 0, 256, 32);
      ctx.fillStyle = '#e63946';
      ctx.fillRect(0, 0, 256, 3);
      ctx.fillRect(0, 29, 256, 3);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('OVERSTEER  3D', 128, 17);
    }, false);
    // BoxGeometry faces are +x, -x, +y, -y, +z, -z: the banner goes on the two big faces across the road (-x is the
    // one drivers see coming up to the line).
    const bannerMat = new THREE.MeshBasicMaterial({ map: banner });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2, 7, span * 2 + 2.4), [bannerMat, bannerMat, postMat, postMat, postMat, postMat]);
    bar.position.set(0, 26, 0);
    bar.castShadow = true;
    holder.add(bar);
    this.scene.add(holder);
    this.buildGrandstand(p, f);
  }

  /** A grandstand full of people beside the start, on whichever side has room. */
  private buildGrandstand(p: RoadPt, f: { tx: number; ty: number; nx: number; ny: number }): void {
    const len = 70;
    const depth = 26;
    for (const side of [-1, 1]) {
      const off = p.half + KERB + 10;
      const ok = [0, 0.5, 1].every((d) => [-1, 0, 1].every((a) => {
        const x = p.x + f.nx * side * (off + d * depth) + f.tx * (24 + a * len / 2);
        const y = p.y + f.ny * side * (off + d * depth) + f.ty * (24 + a * len / 2);
        return !this.grid.near(x, y, 6);
      }));
      if (!ok) continue;
      const g = new THREE.Group();
      g.position.set(p.x + f.nx * side * off + f.tx * 24, 0, p.y + f.ny * side * off + f.ty * 24);
      g.rotation.y = -Math.atan2(f.ty, f.tx);
      const crowd = canvasTexture(64, 4, (ctx) => {
        const r = rng(`${this.def.id}-crowd`);
        const cols = ['#e63946', '#ffd166', '#4895ef', '#52b788', '#f1faee', '#c77dff', '#f4a261'];
        ctx.fillStyle = '#3d405b';
        ctx.fillRect(0, 0, 64, 4);
        for (let x = 0; x < 64; x++) for (let y = 0; y < 4; y++) if (r() > 0.25) {
          ctx.fillStyle = cols[Math.floor(r() * cols.length)];
          ctx.fillRect(x, y, 1, 1);
        }
      });
      crowd.wrapS = THREE.RepeatWrapping;
      crowd.repeat.set(4, 1);
      const concrete = lambert(0x8d99ae);
      const people = new THREE.MeshLambertMaterial({ map: crowd });
      for (let k = 0; k < 4; k++) {
        const h = 3 + k * 3.2;
        const step = new THREE.Mesh(new THREE.BoxGeometry(len, h, depth / 4), concrete);
        step.position.set(0, h / 2, side * (k + 0.5) * (depth / 4));
        step.castShadow = step.receiveShadow = true;
        const folk = new THREE.Mesh(new THREE.BoxGeometry(len - 2, 1.6, depth / 4 - 1.5), people);
        folk.position.set(0, h + 0.8, side * (k + 0.5) * (depth / 4));
        g.add(step, folk);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 1, depth + 4), lambert(0xe63946));
      roof.position.set(0, 24, side * depth / 2);
      roof.castShadow = true;
      g.add(roof);
      for (const x of [-len / 2, len / 2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(1.5, 24, 1.5), lambert(0x2b2d42));
        post.position.set(x, 12, side * depth);
        g.add(post);
      }
      this.scene.add(g);
      return;
    }
  }

  private buildProps(box: { x0: number; x1: number; y0: number; y1: number }, rand: () => number): void {
    const kinds = propKinds(this.def.theme);
    const total = kinds.reduce((s, k) => s + k.weight, 0);
    const placed = kinds.map(() => [] as THREE.Matrix4[]);
    const pad = 420;
    const w = box.x1 - box.x0 + pad * 2;
    const h = box.y1 - box.y0 + pad * 2;
    const count = Math.min(900, Math.round((w * h) / 9000));
    for (let i = 0; i < count; i++) {
      const x = box.x0 - pad + rand() * w;
      const y = box.y0 - pad + rand() * h;
      let r = rand() * total;
      let k = 0;
      while (k < kinds.length - 1 && (r -= kinds[k].weight) > 0) k++;
      const s = 0.75 + rand() * 0.6;
      if (this.grid.near(x, y, KERB + 8 + kinds[k].radius * s)) continue;
      placed[k].push(at(x, 0, y, 0, rand() * Math.PI * 2, 0, s));
    }
    kinds.forEach((kind, i) => instanced(kind.parts, placed[i], true).forEach((m) => this.scene.add(m)));
  }

  /** Mountains (mesas in the desert, a city at night) all round the horizon. */
  private buildHorizon(cx: number, cy: number, span: number, rand: () => number): void {
    const L = this.look;
    const theme = this.def.theme;
    const hills: THREE.Matrix4[] = [];
    const caps: THREE.Matrix4[] = [];
    const towers: THREE.Matrix4[] = [];
    const ring = span / 2 + 800;
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rand() * 0.08;
      const d = ring + rand() * 1100;
      const x = cx + Math.cos(a) * d;
      const y = cy + Math.sin(a) * d;
      const r = 220 + rand() * 380;
      const hgt = (theme === 'desert' ? 120 : theme === 'grass' ? 140 : 260) + rand() * (theme === 'snow' ? 420 : 220);
      if (theme === 'night' && rand() < 0.55) {
        const bw = 40 + rand() * 70;
        towers.push(at(x, 0, y, 0, rand() * Math.PI, 0, [bw, 90 + rand() * 260, bw]));
        continue;
      }
      hills.push(at(x, hgt / 2, y, 0, rand() * Math.PI, 0, [r, hgt, r]));
      if (L.cap !== null && hgt > 300) caps.push(at(x, hgt - hgt * 0.2 + 1, y, 0, 0, 0, [r * 0.4 * 1.03, hgt * 0.4, r * 0.4 * 1.03]));
    }
    const hillGeo = theme === 'desert' ? new THREE.CylinderGeometry(0.72, 1, 1, 6) : new THREE.ConeGeometry(1, 1, 6);
    const hillParts: Part[] = [{ geo: hillGeo, mat: lambert(L.hills), local: new THREE.Matrix4() }];
    instanced(hillParts, hills, false).forEach((m) => this.scene.add(m));
    if (caps.length && L.cap !== null) {
      instanced([{ geo: new THREE.ConeGeometry(1, 1, 6), mat: lambert(L.cap), local: new THREE.Matrix4() }], caps, false).forEach((m) => this.scene.add(m));
    }
    if (towers.length) {
      const windows = canvasTexture(16, 32, (ctx) => {
        const r = rng(`${this.def.id}-windows`);
        ctx.fillStyle = '#0c0b1a';
        ctx.fillRect(0, 0, 16, 32);
        for (let x = 1; x < 16; x += 2) for (let y = 1; y < 32; y += 2) if (r() > 0.6) {
          ctx.fillStyle = r() > 0.3 ? '#ffd98a' : '#9ad1ff';
          ctx.fillRect(x, y, 1, 1);
        }
      });
      const mat = new THREE.MeshLambertMaterial({ color: 0x1a1830, emissive: 0xffffff, emissiveMap: windows, emissiveIntensity: 0.9 });
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      instanced([{ geo, mat, local: new THREE.Matrix4() }], towers, false).forEach((m) => this.scene.add(m));
    }
    if (this.night) {
      // stars
      const r = rng(`${this.def.id}-stars`);
      const pos: number[] = [];
      for (let i = 0; i < 900; i++) {
        const a = r() * Math.PI * 2;
        const e = 0.08 + r() * 1.3;
        pos.push(cx + Math.cos(a) * Math.cos(e) * 4200, Math.sin(e) * 4200, cy + Math.sin(a) * Math.cos(e) * 4200);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false }));
      this.scene.add(stars);
    }
  }

  /** Night tracks: street lamps along the road, each throwing a pool of warm light. */
  private buildLamps(): void {
    const pts = this.samples;
    const fr = frames(pts);
    const posts: THREE.Matrix4[] = [];
    const pools: THREE.Matrix4[] = [];
    let side = 1;
    for (let i = 0; i < pts.length; i += 30) {
      side = -side;
      const off = side * (pts[i].half + KERB + 4);
      const x = pts[i].x + fr[i].nx * off;
      const y = pts[i].y + fr[i].ny * off;
      if (this.grid.near(x, y, 2)) continue;
      // the arm points back over the road
      posts.push(at(x, 0, y, 0, -Math.atan2(-fr[i].ny * side, -fr[i].nx * side), 0));
      const px = pts[i].x + fr[i].nx * (off - side * 9);
      const py = pts[i].y + fr[i].ny * (off - side * 9);
      pools.push(at(px, ROAD_Y + 0.08, py, -Math.PI / 2, 0, 0, 30));
    }
    const pole = new THREE.BoxGeometry(1.2, 24, 1.2);
    pole.translate(0, 12, 0);
    const arm = new THREE.BoxGeometry(10, 0.9, 0.9);
    arm.translate(5, 24, 0);
    const bulb = new THREE.BoxGeometry(3, 0.8, 2);
    bulb.translate(9, 23.2, 0);
    const dark = lambert(0x2b2d42);
    instanced([
      { geo: pole, mat: dark, local: new THREE.Matrix4() },
      { geo: arm, mat: dark, local: new THREE.Matrix4() },
      { geo: bulb, mat: new THREE.MeshBasicMaterial({ color: 0xffe8a3 }), local: new THREE.Matrix4() },
    ], posts, false).forEach((m) => this.scene.add(m));
    const glow = canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,220,150,0.75)');
      g.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }, false);
    const poolMat = new THREE.MeshBasicMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    instanced([{ geo: new THREE.PlaneGeometry(1, 1), mat: poolMat, local: new THREE.Matrix4() }], pools, false).forEach((m) => this.scene.add(m));
  }

  /** Per-frame: scroll the pad chevrons, keep the sun's shadow around the car, follow the effects setting. */
  update(dt: number, carX: number, carY: number, lowFx: boolean): void {
    for (const t of this.padTextures) t.offset.y = (t.offset.y - dt * 1.6) % 1;
    this.sun.castShadow = !lowFx;
    this.sun.position.set(carX - 90, 170, carY - 60);
    this.sun.target.position.set(carX, 0, carY);
  }

  dispose(): void {
    const seen = new Set<unknown>();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose(); }
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture && !seen.has(v)) { seen.add(v); v.dispose(); }
        mat.dispose();
      }
    });
    (this.scene.background as THREE.Texture | null)?.dispose();
    this.sun.shadow.map?.dispose();
  }
}

let cached: World3D | null = null;

/** The world for this track, reused when the same track is raced again. */
export function worldFor(def: TrackDef, samples: RoadPt[]): World3D {
  if (cached && cached.def.id === def.id) return cached;
  cached?.dispose();
  cached = new World3D(def, samples);
  return cached;
}
