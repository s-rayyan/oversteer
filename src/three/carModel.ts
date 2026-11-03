import * as THREE from 'three';
import type { CarDef } from '../game/cars';

/**
 * A low-poly 3D car built from boxes, an extruded cabin and four wheels, sized from the same footprint as the 2D
 * sprite (length x width in px = world units). Faces +x. The body sits in its own group so it can roll and pitch
 * on its springs while the wheels stay on the road.
 */
export interface CarModel {
  root: THREE.Group;
  body: THREE.Group;
  /** Wheel spinners (rotate about z to roll); the first two are the front wheels. */
  wheels: THREE.Group[];
  /** Front wheel pivots (rotate about y to steer). */
  steer: THREE.Group[];
  radius: number;
  length: number;
  width: number;
  /** Exhaust position (local), where the boost flame comes out. */
  exhaust: THREE.Vector3;
  dispose(): void;
}

export function buildCar(def: CarDef, color: number, ghost = false): CarModel {
  const [L, W] = def.size ?? [16, 9];
  const kart = def.id === 'kart';
  const truck = def.carClass === 'offroader';
  const r = Math.max(1.3, W * (truck ? 0.25 : 0.2));
  const ride = r * (truck ? 0.9 : 0.55);
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

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), mat);
    m.position.set(x, y, z);
    m.castShadow = !ghost;
    body.add(m);
    return m;
  };

  const bodyH = kart ? W * 0.16 : W * 0.3;
  const bodyY = ride + bodyH / 2;
  const top = ride + bodyH;
  box(L, bodyH, W * 0.9, paint, 0, bodyY, 0);
  box(L * 0.98, bodyH * 0.35, W * 0.92, darker, 0, ride + bodyH * 0.17, 0); // sills
  box(L * 0.92, 0.06, W * 0.14, stripeMat, 0, top + 0.03, 0); // racing stripe

  if (kart) {
    // open seat with a helmeted driver
    box(L * 0.3, W * 0.22, W * 0.5, black, -L * 0.12, top + W * 0.11, 0);
    const helmet = new THREE.Mesh(keep(new THREE.SphereGeometry(W * 0.2, 10, 8)), paint);
    helmet.position.set(-L * 0.1, top + W * 0.42, 0);
    helmet.castShadow = !ghost;
    body.add(helmet);
  } else {
    // cabin: a side profile with sloped windscreens, extruded across the car
    const cabL = L * 0.46;
    const cabH = W * (truck ? 0.32 : 0.26);
    const back = -L * 0.22;
    const s = new THREE.Shape();
    s.moveTo(back, 0);
    s.lineTo(back + cabL, 0);
    s.lineTo(back + cabL - cabL * 0.32, cabH);
    s.lineTo(back + cabL * 0.18, cabH);
    s.closePath();
    const depth = W * 0.74;
    const cabGeo = keep(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }));
    cabGeo.translate(0, top, -depth / 2);
    const cab = new THREE.Mesh(cabGeo, glass);
    cab.castShadow = !ghost;
    body.add(cab);
    // body-coloured roof and pillars over the glass
    box(cabL * 0.5, 0.35, depth + 0.1, paint, back + cabL * 0.43, top + cabH, 0);
    box(cabL * 0.92, cabH * 0.55, 0.14, paint, back + cabL * 0.46, top + cabH * 0.28, depth / 2 + 0.03).castShadow = false;
    box(cabL * 0.92, cabH * 0.55, 0.14, paint, back + cabL * 0.46, top + cabH * 0.28, -depth / 2 - 0.03).castShadow = false;
    box(cabL * 0.5, 0.07, W * 0.14, stripeMat, back + cabL * 0.43, top + cabH + 0.2, 0);
    if (L >= 17) {
      // spoiler on the big cars
      box(1.2, 0.3, W * 0.95, black, -L / 2 + 0.6, top + 1.5, 0);
      box(0.5, 1.4, 0.4, black, -L / 2 + 0.8, top + 0.7, W * 0.3);
      box(0.5, 1.4, 0.4, black, -L / 2 + 0.8, top + 0.7, -W * 0.3);
    }
  }
  // lights
  for (const side of [-1, 1]) {
    box(0.3, bodyH * 0.35, W * 0.18, head, L / 2 + 0.05, bodyY + bodyH * 0.1, side * W * 0.3).castShadow = false;
    box(0.3, bodyH * 0.3, W * 0.2, tail, -L / 2 - 0.05, bodyY + bodyH * 0.1, side * W * 0.3).castShadow = false;
  }

  // wheels
  const wheelW = Math.max(1.1, W * 0.17);
  const tyreGeo = keep(new THREE.CylinderGeometry(r, r, wheelW, 14));
  tyreGeo.rotateX(Math.PI / 2);
  const hubGeo = keep(new THREE.CylinderGeometry(r * 0.55, r * 0.55, wheelW + 0.08, 6));
  hubGeo.rotateX(Math.PI / 2);
  const wheels: THREE.Group[] = [];
  const steer: THREE.Group[] = [];
  const axle = L * 0.32;
  for (const [x, front] of [[axle, true], [-axle, false]] as const) {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, r, side * (W / 2 - wheelW * 0.35));
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyreGeo, tyre);
      t.castShadow = !ghost;
      spin.add(t, new THREE.Mesh(hubGeo, hub));
      pivot.add(spin);
      root.add(pivot);
      if (front) {
        wheels.unshift(spin);
        steer.push(pivot);
      } else wheels.push(spin);
    }
  }

  if (ghost) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.material) return;
      const mat = m.material as THREE.MeshLambertMaterial;
      mat.transparent = true;
      mat.opacity = 0.42;
      mat.depthWrite = false;
      m.castShadow = false;
    });
  }

  return {
    root, body, wheels, steer, radius: r, length: L, width: W,
    exhaust: new THREE.Vector3(-L / 2 - 0.4, ride + bodyH * 0.3, 0),
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
