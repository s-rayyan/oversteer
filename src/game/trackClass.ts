// Pure maths (no Phaser) so tracks can be classified from node scripts too.
import { sampleClosedSpline } from './spline.ts';
import type { CarClassId } from './cars.ts';
import type { CtrlPt } from './spline.ts';

export type TrackClassId = 'technical' | 'twisty' | 'highspeed' | 'flowing';

export interface TrackClass {
  id: TrackClassId;
  label: string;
  color: string;
  /** What the track is like, in plain words. */
  blurb: string;
  /** Car class that posts the fastest laps here (measured; see scripts/benchmarkLaps.json). */
  bestCar: CarClassId;
  /** Second-best car class. */
  nextBest: CarClassId;
}

export const TRACK_CLASSES: Record<TrackClassId, TrackClass> = {
  technical: {
    id: 'technical', label: 'TECHNICAL', color: '#e63946',
    blurb: 'Tight corners for 30%+ of the lap. Grip beats raw speed.',
    bestCar: 'gripracer', nextBest: 'speedster',
  },
  twisty: {
    id: 'twisty', label: 'TWISTY', color: '#f4a261',
    blurb: 'Frequent tight bends. Carry speed between them.',
    bestCar: 'speedster', nextBest: 'gripracer',
  },
  highspeed: {
    id: 'highspeed', label: 'HIGH-SPEED', color: '#ffd166',
    blurb: 'Mostly straights (60%+). Top speed wins.',
    bestCar: 'speedster', nextBest: 'gripracer',
  },
  flowing: {
    id: 'flowing', label: 'FLOWING', color: '#52b788',
    blurb: 'Long sweeping bends, few hard corners.',
    bestCar: 'speedster', nextBest: 'gripracer',
  },
};

export interface TrackMetrics {
  length: number; // px
  straightFrac: number; // corner radius > 400 px
  sweepFrac: number; // 150-400 px
  tightFrac: number; // < 150 px
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

/** Decision list, first match wins, so every track gets exactly one class. */
export function classifyTrack(def: { points: ReadonlyArray<CtrlPt>; roadWidth: number }): TrackClassId {
  const m = trackMetrics(def);
  if (m.tightFrac >= 0.27) return 'technical';
  if (m.tightFrac >= 0.10) return 'twisty';
  if (m.straightFrac >= 0.60) return 'highspeed';
  return 'flowing';
}
