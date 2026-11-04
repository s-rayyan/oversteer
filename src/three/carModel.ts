import * as THREE from 'three';
import type { CarDef } from '../game/cars';

/**
 * A low-poly 3D car, sized from the same footprint as the 2D sprite (length x width in px = world units). Faces +x.
 * Every model has its own body style (a hatchback, a lifted rally truck, a long dragster with big rear wheels, an
 * open kart...). The body sits in its own group so it can roll and pitch on its springs while the wheels stay on
 * the road.
 */
export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  /** Wheel spinners (rotate about z to roll); the first two are the front wheels. */
  wheels: THREE.Group[];
  /** Radius of each wheel in `wheels`. */
  radii: number[];
  /** Front wheel pivots (rotate about y to steer). */
  steer: THREE.Group[];
  length: number;
  width: number;
  /** Exhaust position (local), where the boost flame comes out. */
  exhaust: THREE.Vector3;
  dispose(): void;
}

type Style = 'hatch' | 'sedan' | 'coupe' | 'sports' | 'drift' | 'muscle' | 'truck' | 'tank' | 'buggy' | 'kart' | 'dragster' | 'hyper';

const STYLE_OF: Record<string, Style> = {
  hatch: 'hatch', sedan: 'sedan', coupe: 'coupe', gripper: 'sports', phantom: 'sports', comet: 'sports', drifter: 'drift',
  muscle: 'muscle', bruiser: 'muscle', rally: 'truck', tank: 'tank', buggy: 'buggy', kart: 'kart', dragster: 'dragster',
  rocket: 'dragster', legend: 'hyper',
};
const STYLE_OF_CLASS: Record<string, Style> = {
  allrounder: 'sedan', speedster: 'dragster', gripracer: 'sports', drifter: 'drift', offroader: 'truck', booster: 'muscle', agile: 'sports', hypercar: 'hyper',
};

interface Shape {
  /** cabin: length, rear end, height (fractions of the car), front and rear screen slope (fractions of its length) */
  cab: [number, number, number, number, number] | null;
  ride: number; // ground clearance, in wheel radii
  bodyH: number; // fraction of the width
  wheel: number; // wheel radius, fraction of the width
  front: number; // front wheel size relative to the rear
  wing: 'none' | 'lip' | 'wing' | 'big';
  arches: boolean;
}

const SHAPES: Record<Style, Shape> = {
  hatch: { cab: [0.56, -0.47, 0.3, 0.3, 0.05], ride: 0.55, bodyH: 0.3, wheel: 0.2, front: 1, wing: 'lip', arches: false },
  sedan: { cab: [0.44, -0.25, 0.28, 0.3, 0.25], ride: 0.55, bodyH: 0.29, wheel: 0.2, front: 1, wing: 'none', arches: false },
  coupe: { cab: [0.5, -0.32, 0.25, 0.34, 0.5], ride: 0.5, bodyH: 0.27, wheel: 0.2, front: 1, wing: 'lip', arches: false },
  sports: { cab: [0.4, -0.2, 0.2, 0.42, 0.42], ride: 0.4, bodyH: 0.24, wheel: 0.21, front: 1, wing: 'wing', arches: false },
  drift: { cab: [0.42, -0.24, 0.23, 0.36, 0.32], ride: 0.45, bodyH: 0.27, wheel: 0.21, front: 1, wing: 'wing', arches: true },
  muscle: { cab: [0.38, -0.28, 0.23, 0.3, 0.32], ride: 0.5, bodyH: 0.3, wheel: 0.22, front: 0.95, wing: 'lip', arches: true },
  truck: { cab: [0.5, -0.3, 0.34, 0.24, 0.1], ride: 1.0, bodyH: 0.32, wheel: 0.27, front: 1, wing: 'none', arches: true },
  tank: { cab: [0.56, -0.36, 0.34, 0.12, 0.08], ride: 0.95, bodyH: 0.36, wheel: 0.28, front: 1, wing: 'none', arches: false },
  buggy: { cab: null, ride: 1.0, bodyH: 0.2, wheel: 0.28, front: 0.9, wing: 'none', arches: false },
  kart: { cab: null, ride: 0.35, bodyH: 0.14, wheel: 0.2, front: 0.85, wing: 'none', arches: false },
  dragster: { cab: [0.3, -0.36, 0.25, 0.4, 0.35], ride: 0.4, bodyH: 0.22, wheel: 0.24, front: 0.6, wing: 'big', arches: false },
  hyper: { cab: [0.36, -0.14, 0.18, 0.48, 0.5], ride: 0.32, bodyH: 0.22, wheel: 0.21, front: 1, wing: 'big', arches: false },
};

export interface CarOptions {
  ghost?: boolean;
  /** Night: see-through beams of light in front of the headlights. */
  beams?: boolean;
}

export function buildCar(def: CarDef, color: number, opts: CarOptions = {}): CarModel {
  const ghost = !!opts.ghost;
  const [L, W] = def.size ?? [16, 9];
  const style = STYLE_OF[def.id] ?? STYLE_OF_CLASS[def.carClass] ?? 'sedan';
  const sh = SHAPES[style];
  const rr = Math.max(1.3, W * sh.wheel); // rear wheel radius
  const rf = Math.max(1.1, rr * sh.front);
  const ride = rr * sh.ride;
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x; };

  const base = new THREE.Color(color);
  const paint = keep(new THREE.MeshPhongMaterial({ color: base, shininess: 70, specular: 0x555555 }));
  const darker = keep(new THREE.MeshLambertMaterial({ color: base.clone().multiplyScalar(0.55) }));
  const glass = keep(new THREE.MeshPhongMaterial({ color: 0x1d3557, shininess: 120, specular: 0x9ad1ff }));
  const stripeMat = keep(new THREE.MeshLambertMaterial({ color: def.stripe ?? 0xffffff }));
  const tyre = keep(new THREE.MeshLambertMaterial({ color: 0x18171f }));
  const hub = keep(new THREE.MeshLambertMaterial({ color: 0xb4bbc4 }));
  const head = keep(new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
  const tail = keep(new THREE.MeshBasicMaterial({ color: 0xff3b4a }));
  const black = keep(new THREE.MeshLambertMaterial({ color: 0x14121f }));
  const metal = keep(new THREE.MeshPhongMaterial({ color: 0x8d99ae, shininess: 90 }));

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    m.castShadow = shadow && !ghost;
    body.add(m);
    return m;
  };
  const tube = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, mat: THREE.Material) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1);
    const m = new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6)), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = !ghost;
    body.add(m);
  };

  const bodyH = W * sh.bodyH;
  const bodyY = ride + bodyH / 2;
  const top = ride + bodyH;
  const open = style === 'kart' || style === 'buggy';
  const bodyW = W * (open ? 0.62 : 0.9);

  if (style === 'dragster') {
    // long, low nose; the cabin and engine sit at the back
    box(L, bodyH * 0.7, bodyW * 0.6, paint, 0.02 * L, ride + bodyH * 0.35, 0);
    box(L * 0.5, bodyH, bodyW, paint, -L * 0.25, bodyY, 0);
    box(L * 0.12, bodyH * 0.8, W * 0.4, metal, -L * 0.07, top + bodyH * 0.35, 0); // engine block
    box(L * 0.03, bodyH * 0.6, W * 0.2, black, -L * 0.07, top + bodyH * 0.95, 0); // air scoop
  } else {
    box(L, bodyH, bodyW, paint, 0, bodyY, 0);
    if (!open) box(L * 0.98, bodyH * 0.35, bodyW + 0.1, darker, 0, ride + bodyH * 0.17, 0); // sills
  }
  if (!open) box(L * 0.92, 0.06, W * 0.14, stripeMat, 0, top + 0.03, 0); // racing stripe

  if (style === 'kart' || style === 'buggy') {
    box(L * 0.3, W * 0.22, W * 0.45, black, -L * 0.12, top + W * 0.11, 0); // seat
    const helmet = new THREE.Mesh(keep(new THREE.SphereGeometry(W * 0.17, 10, 8)), paint);
    helmet.position.set(-L * 0.1, top + W * 0.38, 0);
    helmet.castShadow = !ghost;
    body.add(helmet);
    if (style === 'kart') {
      box(L * 0.12, W * 0.08, W * 0.9, black, L * 0.47, ride + 0.4, 0); // front bumper
      box(L * 0.1, W * 0.08, W * 0.9, black, -L * 0.47, ride + 0.4, 0);
    } else {
      // roll cage
      const cy = top + W * 0.62;
      for (const z of [-1, 1]) {
        tube(L * 0.12, top, z * W * 0.28, L * 0.02, cy, z * W * 0.25, 0.28, metal);
        tube(-L * 0.3, top, z * W * 0.28, -L * 0.22, cy, z * W * 0.25, 0.28, metal);
        tube(L * 0.02, cy, z * W * 0.25, -L * 0.22, cy, z * W * 0.25, 0.28, metal);
      }
      tube(L * 0.02, cy, -W * 0.25, L * 0.02, cy, W * 0.25, 0.28, metal);
      tube(-L * 0.22, cy, -W * 0.25, -L * 0.22, cy, W * 0.25, 0.28, metal);
      box(L * 0.18, 0.4, W * 0.5, paint, L * 0.36, top - 0.1, 0); // bonnet
    }
  } else if (sh.cab) {
    // cabin: a side profile with sloped screens, extruded across the car
    const [cl, cb, ch, fs, rs] = sh.cab;
    const cabL = L * cl;
    const cabH = W * ch;
    const back = L * cb;
    const s = new THREE.Shape();
    s.moveTo(back, 0);
    s.lineTo(back + cabL, 0);
    s.lineTo(back + cabL - cabL * fs, cabH);
    s.lineTo(back + cabL * rs, cabH);
    s.closePath();
    const depth = bodyW * 0.82;
    const cabGeo = keep(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }));
    cabGeo.translate(0, top, -depth / 2);
    const cab = new THREE.Mesh(cabGeo, glass);
    cab.castShadow = !ghost;
    body.add(cab);
    // body-coloured roof and pillars over the glass
    const roofL = cabL * (1 - fs - rs) + 0.3;
    const roofX = back + cabL * rs + roofL / 2 - 0.15;
    box(roofL, 0.35, depth + 0.1, paint, roofX, top + cabH, 0);
    box(cabL * 0.9, cabH * 0.5, 0.14, paint, back + cabL * 0.5, top + cabH * 0.25, depth / 2 + 0.03, false);
    box(cabL * 0.9, cabH * 0.5, 0.14, paint, back + cabL * 0.5, top + cabH * 0.25, -depth / 2 - 0.03, false);
    box(roofL, 0.07, W * 0.14, stripeMat, roofX, top + cabH + 0.2, 0);
    if (style === 'truck') {
      // light bar on the roof and a bull bar
      box(roofL * 0.9, 0.5, depth * 0.95, black, roofX, top + cabH + 0.55, 0);
      for (const z of [-0.36, -0.12, 0.12, 0.36]) box(0.3, 0.45, depth * 0.18, head, roofX + roofL * 0.45, top + cabH + 0.55, z * depth, false);
      tube(L / 2 + 0.5, ride, -W * 0.3, L / 2 + 0.5, top + 0.4, -W * 0.3, 0.3, metal);
      tube(L / 2 + 0.5, ride, W * 0.3, L / 2 + 0.5, top + 0.4, W * 0.3, 0.3, metal);
      tube(L / 2 + 0.5, top + 0.4, -W * 0.3, L / 2 + 0.5, top + 0.4, W * 0.3, 0.3, metal);
    }
    if (style === 'tank') {
      box(L * 0.18, 0.5, W * 0.3, darker, roofX - roofL * 0.1, top + cabH + 0.4, 0); // roof hatch
      box(L, 0.5, 0.35, darker, 0, top - 0.2, bodyW / 2 + 0.15); // armour skirts
      box(L, 0.5, 0.35, darker, 0, top - 0.2, -bodyW / 2 - 0.15);
    }
    if (style === 'hyper') {
      box(L * 0.22, bodyH * 0.6, 0.2, black, -L * 0.08, bodyY, bodyW / 2 + 0.05, false); // side intakes
      box(L * 0.22, bodyH * 0.6, 0.2, black, -L * 0.08, bodyY, -bodyW / 2 - 0.05, false);
      box(1, 0.2, bodyW * 1.02, black, L / 2 - 0.3, ride + 0.1, 0); // splitter
    }
    if (style === 'sports') box(0.8, 0.2, bodyW * 1.02, black, L / 2 - 0.3, ride + 0.1, 0);
  }
  if (style === 'muscle') {
    box(L * 0.16, bodyH * 0.3, W * 0.22, black, L * 0.25, top + bodyH * 0.15, 0); // bonnet scoop
    for (const z of [-0.25, 0.25]) {
      const ex = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.45, 0.45, 1.4, 8)), metal);
      ex.rotation.z = Math.PI / 2;
      ex.position.set(-L / 2 - 0.3, ride + 0.4, z * W);
      body.add(ex);
    }
  }

  // wings
  const wingY = top + (sh.wing === 'big' ? 2.6 : 1.5);
  if (sh.wing === 'lip') box(0.9, 0.3, bodyW * 0.95, darker, -L / 2 + 0.45, top + 0.15, 0);
  if (sh.wing === 'wing' || sh.wing === 'big') {
    const ww = sh.wing === 'big' ? W * 1.0 : bodyW * 0.95;
    box(sh.wing === 'big' ? 2 : 1.3, 0.3, ww, black, -L / 2 + 0.7, wingY, 0);
    if (sh.wing === 'big') for (const z of [-1, 1]) box(1.8, 1.2, 0.2, black, -L / 2 + 0.7, wingY + 0.2, z * ww / 2); // end plates
    for (const z of [-0.3, 0.3]) box(0.5, wingY - top, 0.4, black, -L / 2 + 0.9, top + (wingY - top) / 2, z * W);
  }

  // lights
  if (!open) {
    for (const side of [-1, 1]) {
      box(0.3, bodyH * 0.3, W * 0.17, head, L / 2 + 0.05, bodyY + bodyH * 0.1, side * bodyW * 0.33, false);
      box(0.3, bodyH * 0.28, W * 0.2, tail, -L / 2 - 0.05, bodyY + bodyH * 0.1, side * bodyW * 0.33, false);
    }
  }

  // wheels (and arches over them)
  const wheelW = Math.max(1.1, W * (style === 'truck' || style === 'tank' || style === 'buggy' ? 0.22 : 0.17));
  const wheels: THREE.Group[] = [];
  const radii: number[] = [];
  const steer: THREE.Group[] = [];
  const axleF = L * (style === 'dragster' ? 0.4 : 0.32);
  const axleR = -L * 0.32;
  const halfTrack = open ? W / 2 - wheelW * 0.5 : W / 2 - wheelW * 0.35;
  for (const [x, front] of [[axleF, true], [axleR, false]] as const) {
    const r = front ? rf : rr;
    const tyreGeo = keep(new THREE.CylinderGeometry(r, r, wheelW, 14));
    tyreGeo.rotateX(Math.PI / 2);
    const hubGeo = keep(new THREE.CylinderGeometry(r * 0.55, r * 0.55, wheelW + 0.08, 6));
    hubGeo.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, r, side * halfTrack);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyreGeo, tyre);
      t.castShadow = !ghost;
      spin.add(t, new THREE.Mesh(hubGeo, hub));
      pivot.add(spin);
      root.add(pivot);
      if (front) {
        wheels.unshift(spin);
        radii.unshift(r);
        steer.push(pivot);
      } else {
        wheels.push(spin);
        radii.push(r);
      }
      if (sh.arches) box(r * 2.4, 0.6, wheelW + 0.4, darker, x, r * 2 + 0.1, side * halfTrack, false);
    }
  }

  // night: the headlights throw a fan of light on the road ahead
  if (opts.beams) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(0, 16, 0, 0, 16, 64);
    g.addColorStop(0, 'rgba(255,241,200,0.9)');
    g.addColorStop(0.5, 'rgba(255,241,200,0.35)');
    g.addColorStop(1, 'rgba(255,241,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 13); ctx.lineTo(64, 0); ctx.lineTo(64, 32); ctx.lineTo(0, 19);
    ctx.closePath();
    ctx.fill();
    const tex = keep(new THREE.CanvasTexture(c));
    const mat = keep(new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: ghost ? 0.35 : 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    const geo = keep(new THREE.PlaneGeometry(46, W * 3.2));
    geo.rotateX(-Math.PI / 2);
    const pool = new THREE.Mesh(geo, mat);
    pool.position.set(L / 2 + 22, 0.35, 0);
    pool.renderOrder = 2;
    root.add(pool);
  }

  if (ghost) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.material) return;
      const mat = m.material as THREE.MeshLambertMaterial;
      if (mat.blending === THREE.AdditiveBlending) return;
      mat.transparent = true;
      mat.opacity = 0.42;
      mat.depthWrite = false;
      m.castShadow = false;
    });
  }

  return {
    root, body, wheels, radii, steer, length: L, width: W,
    exhaust: new THREE.Vector3(-L / 2 - 0.4, ride + bodyH * 0.3, 0),
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
