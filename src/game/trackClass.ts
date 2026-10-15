// Pure maths (no Phaser) so tracks can be classified from node scripts too.
import { sampleClosedSpline } from './spline.ts';
import type { CtrlPt } from './spline.ts';
import type { SurfaceDef } from './surfaces.ts';

export type TrackClassId = 'tour' | 'rally' | 'boost' | 'drift' | 'hairpin' | 'technical' | 'twisty' | 'highspeed' | 'flowing';

export interface TrackClass {
  id: TrackClassId;
  label: string;
  color: string;
  /** What the track is like, in plain words. */
  blurb: string;
}

export const TRACK_CLASSES: Record<TrackClassId, TrackClass> = {
  tour: { id: 'tour', label: 'GRAND TOUR', color: '#ffffff', blurb: 'A bit of everything: gravel, pads, drift zones.' },
  rally: { id: 'rally', label: 'RALLY', color: '#c9a66b', blurb: 'Gravel for 30%+ of the lap.' },
  boost: { id: 'boost', label: 'BOOST', color: '#ffd166', blurb: 'Six or more boost pads.' },
  drift: { id: 'drift', label: 'DRIFT', color: '#4895ef', blurb: 'Drift zones over 25%+ of the lap.' },
  hairpin: { id: 'hairpin', label: 'HAIRPIN', color: '#c77dff', blurb: 'Tight corners for 34%+ of the lap.' },
  technical: { id: 'technical', label: 'TECHNICAL', color: '#e63946', blurb: 'Tight corners for 27%+ of the lap.' },
  twisty: { id: 'twisty', label: 'TWISTY', color: '#f4a261', blurb: 'Frequent tight bends. Carry speed between them.' },
  highspeed: { id: 'highspeed', label: 'HIGH-SPEED', color: '#ffd166', blurb: 'Mostly straights (60%+).' },
  flowing: { id: 'flowing', label: 'FLOWING', color: '#52b788', blurb: 'Long sweeping bends, few hard corners.' },
};

export interface TrackMetrics {
  length: number; // px
  straightFrac: number; // corner radius > 400 px
  sweepFrac: number; // 150-400 px
  tightFrac: number; // < 150 px
}

interface ClassifiableTrack extends SurfaceDef {
  points: ReadonlyArray<CtrlPt>;
  roadWidth: number;
}

/** Fractions of the lap spent on straights, sweeping bends and tight corners. */
export function trackMetrics(def: { points: ReadonlyArray<CtrlPt>; roadWidth: number }): TrackMetrics {
  const pts = sampleClosedSpline(def.points, 4, def.roadWidth);
  const n = pts.length;
  const k = 6; // radius from the points 6 samples (24 px) either side
  let straight = 0, sweep = 0, tight = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - k + n) % n], b = pts[i], c = pts[(i + k) % n];
    const ab = Math.hypot(a.x - b.x, a.y - b.y), bc = Math.hypot(b.x - c.x, b.y - c.y), ca = Math.hypot(c.x - a.x, c.y - a.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    const R = area2 < 1e-6 ? Infinity : (ab * bc * ca) / (2 * area2);
    if (R > 400) straight++;
    else if (R > 150) sweep++;
    else tight++;
  }
  return { length: n * 4, straightFrac: straight / n, sweepFrac: sweep / n, tightFrac: tight / n };
}

const coverage = (r?: ReadonlyArray<readonly [number, number]>): number => (r ?? []).reduce((a, [x, y]) => a + (y - x), 0);

/** Decision list, first match wins, so every track gets exactly one class. */
export function classifyTrack(def: ClassifiableTrack): TrackClassId {
  const rough = coverage(def.rough), zones = coverage(def.zones), pads = def.pads?.length ?? 0;
  if (rough > 0 && pads > 0 && zones > 0) return 'tour';
  if (rough >= 0.3) return 'rally';
  if (pads >= 6) return 'boost';
  if (zones >= 0.25) return 'drift';
  const m = trackMetrics(def);
  if (m.tightFrac >= 0.34) return 'hairpin';
  if (m.tightFrac >= 0.27) return 'technical';
  if (m.tightFrac >= 0.10) return 'twisty';
  if (m.straightFrac >= 0.60) return 'highspeed';
  return 'flowing';
}
