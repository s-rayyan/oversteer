import { sampleClosedSpline, type CtrlPt } from '../src/game/spline.ts';

export interface Metrics {
  ok: boolean;
  len: number;
  minGapSlack: number; // smallest (distance - required) over distant road pairs; must be >= 0
  minRSlack: number; // smallest (radius - (halfWidth + 6)); must be >= 0
  gapAt: string;
  rAt: string;
  minW: number;
  maxW: number;
}

/** Checks a layout (with per-point widths): no overlaps between distant road, no corners tighter than the road. */
export function measure(points: ReadonlyArray<CtrlPt>, baseWidth: number): Metrics {
  const pts = sampleClosedSpline(points, 4, baseWidth);
  const n = pts.length;
  let minGapSlack = Infinity, minRSlack = Infinity, gapAt = '', rAt = '';
  let minW = Infinity, maxW = 0;

  for (let i = 0; i < n; i++) {
    minW = Math.min(minW, pts[i].w);
    maxW = Math.max(maxW, pts[i].w);
    for (let j = i + 1; j < n; j += 2) {
      const arc = Math.min(j - i, n - (j - i));
      const need = (pts[i].w + pts[j].w) / 2 + 14; // two half-widths + kerb gap
      if (arc < ((pts[i].w + pts[j].w) * 1.5) / 4) continue;
      const slack = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) - need - 0;
      if (slack < minGapSlack) { minGapSlack = slack; gapAt = `${Math.round(pts[i].x)},${Math.round(pts[i].y)}`; }
    }
  }

  const k = 8;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - k + n) % n], b = pts[i], c = pts[(i + k) % n];
    const ab = Math.hypot(a.x - b.x, a.y - b.y), bc = Math.hypot(b.x - c.x, b.y - c.y), ca = Math.hypot(c.x - a.x, c.y - a.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    const R = area2 < 1e-6 ? Infinity : (ab * bc * ca) / (2 * area2);
    const slack = R - (b.w / 2 + 6);
    if (slack < minRSlack) { minRSlack = slack; rAt = `${Math.round(b.x)},${Math.round(b.y)}`; }
  }
  return { ok: minGapSlack >= 0 && minRSlack >= 0, len: n * 4, minGapSlack, minRSlack, gapAt, rAt, minW, maxW };
}
