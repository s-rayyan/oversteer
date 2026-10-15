// Headless lap simulator: the game's own CarPhysics + track maths + lap logic, driven by a bot.
// Used to benchmark and balance cars without opening a browser (see benchmark.ts).
// To check that the game itself agrees with this simulator, run scripts/benchmarkLaps.js in the browser console.
import { CarPhysics, DRIFT_MIN_SPEED, DRIFT_SLIP, ZONE_CHARGE_MULT, chargeBoost, drainBoost } from '../src/game/carPhysics.ts';
import { CARS, effectiveStats, noUpgrades, type CarDef, type CarStats } from '../src/game/cars.ts';
import { sampleClosedSpline } from '../src/game/spline.ts';
import { surfaceFlags } from '../src/game/surfaces.ts';
import { TRACKS, type TrackDef } from '../src/game/tracks.ts';

export interface RoadPt { x: number; y: number; half: number; rough?: boolean; pad?: boolean; zone?: boolean }
export interface Input { throttle: number; steer: number; boost: boolean; handbrake: boolean }

/** What a controller can see each step. */
export interface View {
  car: CarPhysics;
  samples: RoadPt[];
  idx: number; // nearest road sample
  boost: number; // boost meter 0..1
  dt: number;
}
export type Controller = (v: View) => Input;

const WINDOW = 40; // samples searched either side of the last known position (same as RaceScene)

export function roadFor(t: TrackDef): RoadPt[] {
  const pts = sampleClosedSpline(t.points, 4, t.roadWidth);
  const flags = surfaceFlags(pts.length, t);
  return pts.map((p, i) => ({ x: p.x, y: p.y, half: p.w / 2, ...flags[i] }));
}

export interface LapResult { lap: number | null; offRoadSec: number; boostSec: number; driftSec: number }

/** First-lap time, stepping exactly like RaceScene/DriveScene do (fixed dt, same order of operations). */
export function lapTime(road: RoadPt[], stats: CarStats, ctrl: Controller, dt = 0.05, maxT = 200): LapResult {
  const n = road.length;
  const grid = 14; // start a little behind the line
  let idx = n - grid, total = -grid, maxTotal = -grid;
  const p0 = road[idx], q0 = road[(idx + 3) % n];
  const car = new CarPhysics(stats, p0.x, p0.y, Math.atan2(q0.y - p0.y, q0.x - p0.x));
  let boost = 0, raceTime = 0, lapStart = 0, off = false, offSec = 0, boostSec = 0, driftSec = 0, onPad = false;

  while (raceTime < maxT) {
    const inp = ctrl({ car, samples: road, idx, boost, dt });
    const boosting = inp.boost && boost > 0;
    raceTime += dt;

    // RaceScene.updateMode: progress along the road and whether we're on grass
    let best = idx, bd = Infinity;
    for (let d = -WINDOW; d <= WINDOW; d++) {
      const j = (idx + d + n) % n;
      const dx = road[j].x - car.x, dy = road[j].y - car.y, dist = dx * dx + dy * dy;
      if (dist < bd) { bd = dist; best = j; }
    }
    let delta = best - idx;
    if (delta < -n / 2) delta += n; else if (delta > n / 2) delta -= n;
    idx = best; total += delta;
    if (total > maxTotal) {
      const before = Math.floor(maxTotal / n), after = Math.floor(total / n);
      maxTotal = total;
      if (after > before) {
        if (after === 0) lapStart = raceTime;
        else return { lap: raceTime - lapStart, offRoadSec: offSec, boostSec, driftSec };
      }
    }
    off = Math.sqrt(bd) > road[best].half;

    const here = road[best];
    car.offRoad = off;
    car.rough = !off && !!here.rough;
    car.step(dt, inp.throttle, inp.steer, boosting, inp.handbrake);
    if (boosting) { boost = drainBoost(boost, stats, dt); boostSec += dt; }
    // drift zones charge boost from raw slip; elsewhere it's the heat-scaled slip
    const slip = here.zone ? car.rawSlip : car.slip;
    if (!off && slip > DRIFT_SLIP && car.speed > DRIFT_MIN_SPEED) { boost = chargeBoost(boost, slip * (here.zone ? ZONE_CHARGE_MULT : 1), stats, dt); driftSec += dt; }
    const nowPad = !off && !!here.pad;
    if (nowPad && !onPad) boost = Math.min(1, boost + stats.padGain);
    onPad = nowPad;
    if (off) offSec += dt;
  }
  return { lap: null, offRoadSec: offSec, boostSec, driftSec };
}

/** The bot used for the first benchmark (kept so the simulator can be checked against the real game). */
export const baselineBot: Controller = ({ car, samples, idx, boost }) => {
  const n = samples.length, sp = car.speed;
  const look = Math.max(12, Math.min(40, Math.round(10 + sp * 0.12)));
  const aim = samples[(idx + look) % n];
  const want = Math.atan2(aim.y - car.y, aim.x - car.x);
  const d = Math.atan2(Math.sin(want - car.heading), Math.cos(want - car.heading)), ad = Math.abs(d);
  const steer = (d > 0.04 ? 1 : 0) - (d < -0.04 ? 1 : 0);
  const left = d < -0.04, right = d > 0.04;
  return {
    steer: right && left ? 0 : steer,
    throttle: ad > 1.1 && sp > 60 ? -1 : !(ad > 0.6 && sp > 85) ? 1 : 0,
    boost: ad < 0.25 && boost > 0.05,
    handbrake: ad > 0.8 && sp > 70,
  };
};

export const carStats = (c: CarDef): CarStats => effectiveStats(c, noUpgrades());
