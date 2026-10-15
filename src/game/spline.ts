// Pure maths (no Phaser) so it can also run under node for the track validator.
export interface Pt {
  x: number;
  y: number;
}

/** A track control point: x, y and an optional road width (px) at that point. */
export type CtrlPt = readonly [number, number] | readonly [number, number, number];

export interface WPt extends Pt {
  w: number;
}

type P = readonly [number, number];

/** Centripetal Catmull-Rom (Barry-Goldman): never cusps or self-loops on uneven control points. */
function centripetal(p0: P, p1: P, p2: P, p3: P, t: number): Pt {
  const d = (a: P, b: P) => Math.max(Math.pow(Math.hypot(a[0] - b[0], a[1] - b[1]), 0.5), 1e-4);
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const mix = (a: P, b: P, ta: number, tb: number): P => {
    const w = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = mix(p0, p1, t0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2);
  const b2 = mix(a2, a3, t1, t3);
  const c = mix(b1, b2, t1, t2);
  return { x: c[0], y: c[1] };
}

/**
 * Points roughly `step` px apart along a *closed* spline (no seam at the join).
 * Road width is eased between control points (a point without its own width uses `baseWidth`).
 */
export function sampleClosedSpline(ctrl: ReadonlyArray<CtrlPt>, step = 4, baseWidth = 0): WPt[] {
  const n = ctrl.length;
  const xy = ctrl.map((c): P => [c[0], c[1]]);
  const wd = ctrl.map((c) => (c.length === 3 ? c[2] : baseWidth));
  const out: WPt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = xy[(i - 1 + n) % n];
    const p1 = xy[i];
    const p2 = xy[(i + 1) % n];
    const p3 = xy[(i + 2) % n];
    const w1 = wd[i];
    const w2 = wd[(i + 1) % n];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const e = t * t * (3 - 2 * t); // smoothstep so width changes ease in and out
      out.push({ ...centripetal(p0, p1, p2, p3, t), w: w1 + (w2 - w1) * e });
    }
  }
  return out;
}
