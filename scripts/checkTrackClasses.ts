// Classifies every track from its geometry and checks that the recommended car class really is the
// fastest in the benchmark data (scripts/benchmarkLaps.json). Run: npm run check:trackclasses
import { readFileSync } from 'node:fs';
import { CARS, CAR_CLASSES, type CarClassId } from '../src/game/cars.ts';
import { TRACKS } from '../src/game/tracks.ts';
import { TRACK_CLASSES, classifyTrack, trackMetrics } from '../src/game/trackClass.ts';

const laps: Record<string, Record<string, number>> = JSON.parse(readFileSync(new URL('./benchmarkLaps.json', import.meta.url), 'utf8'));
const classOf = Object.fromEntries(CARS.map((c) => [c.id, c.carClass])) as Record<string, CarClassId>;

let bad = 0;
const counts: Record<string, number> = {};
console.log('track             class       tight straight | fastest classes (mean lap, s; hypercar excluded)   recommended');
for (const t of TRACKS) {
  const cls = classifyTrack(t);
  counts[cls] = (counts[cls] ?? 0) + 1;
  const m = trackMetrics(t);
  const res = laps[t.id];
  const mean = new Map<CarClassId, number>();
  for (const id of Object.keys(CAR_CLASSES) as CarClassId[]) {
    if (id === 'hypercar') continue;
    const v = CARS.filter((c) => c.carClass === id).map((c) => res[c.id]);
    mean.set(id, v.reduce((a, b) => a + b, 0) / v.length);
  }
  const ranked = [...mean.entries()].sort((a, b) => a[1] - b[1]);
  const [best, second] = [ranked[0][0], ranked[1][0]];
  const rec = TRACK_CLASSES[cls];
  const ok = best === rec.bestCar && second === rec.nextBest;
  if (!ok) bad++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${t.name.padEnd(16)} ${TRACK_CLASSES[cls].label.padEnd(11)} ${m.tightFrac.toFixed(2)}  ${m.straightFrac.toFixed(2)}   | ` +
    `${CAR_CLASSES[best].label} ${ranked[0][1].toFixed(1)}, ${CAR_CLASSES[second].label} ${ranked[1][1].toFixed(1)}   -> ${CAR_CLASSES[rec.bestCar].label}`,
  );
}
console.log('\ntracks per class:', counts);
process.exit(bad ? 1 : 0);
