// Keeps the per-track minimum race times in firestore.rules in step with the tracks and cars.
// Run: npm run check:rules (fails if they're out of date); npm run check:rules -- --write (updates them).
import { readFileSync, writeFileSync } from 'node:fs';
import { CARS, MAX_LEVEL, UPGRADES, effectiveStats, type Levels } from '../src/game/cars.ts';
import { TRACKS } from '../src/game/tracks.ts';
import { measure } from './trackMetrics.ts';

const RULES = new URL('../firestore.rules', import.meta.url);
const FLOOR = 0.5; // fraction of the centre-line time at top speed that still counts as believable

const maxed = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, MAX_LEVEL])) as unknown as Levels;
const topSpeed = Math.max(...CARS.map((c) => {
  const s = effectiveStats(c, maxed);
  return s.maxSpeed * s.boostSpeed;
}));

const floors = TRACKS.map((t) => {
  const ms = (t.laps * measure(t.points, t.roadWidth).len / topSpeed) * 1000 * FLOOR;
  return [t.id, Math.floor(ms / 100) * 100] as const;
});
const body = floors.map(([id, ms]) => `          '${id}': ${ms}`).join(',\n');
const block = `        // BEGIN GENERATED\n        return {\n${body}\n        }.get(b, 3600000);\n        // END GENERATED`;

const rules = readFileSync(RULES, 'utf8');
const updated = rules.replace(/ {8}\/\/ BEGIN GENERATED[\s\S]*?\/\/ END GENERATED/, block);
if (updated === rules) {
  console.log(`ok   firestore.rules minimum times match ${floors.length} tracks (top speed ${topSpeed.toFixed(0)} px/s)`);
} else if (process.argv.includes('--write')) {
  writeFileSync(RULES, updated);
  console.log(`wrote minimum times for ${floors.length} tracks to firestore.rules; deploy with: firebase deploy --only firestore:rules`);
} else {
  console.log('FAIL firestore.rules minimum times are out of date: run npm run check:rules -- --write');
  process.exit(1);
}
