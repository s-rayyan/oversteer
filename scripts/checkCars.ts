// Verifies every car's class matches its stats, and that each car fits exactly one class.
// Run: npm run check:cars
import { CARS, CAR_CLASSES, type CarClassId } from '../src/game/cars.ts';

let bad = 0;
for (const c of CARS) {
  const matching = (Object.keys(CAR_CLASSES) as CarClassId[]).filter((id) => CAR_CLASSES[id].matches(c.stats));
  const ok = matching.length === 1 && matching[0] === c.carClass;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(10)} declared ${CAR_CLASSES[c.carClass].label.padEnd(12)} rules say: ${matching.map((m) => CAR_CLASSES[m].label).join(' + ') || 'NOTHING'}`);
}
const unused = (Object.keys(CAR_CLASSES) as CarClassId[]).filter((id) => !CARS.some((c) => c.carClass === id));
if (unused.length) console.log(`note: no car in class ${unused.join(', ')}`);
process.exit(bad ? 1 : 0);
