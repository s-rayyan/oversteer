// Sanity-checks every track. Run: npm run check:tracks
import { TRACKS } from '../src/game/tracks.ts';
import { measure } from './trackMetrics.ts';

let bad = 0;
for (const t of TRACKS) {
  const m = measure(t.points, t.roadWidth);
  console.log(
    `${m.ok ? 'ok  ' : 'FAIL'} ${t.name.padEnd(20)} len ${String(m.len).padStart(4)}px  ~${(m.len / 85).toFixed(0)}s/lap  width ${Math.round(m.minW)}-${Math.round(m.maxW)}  gapSlack ${m.minGapSlack.toFixed(0)}  rSlack ${m.minRSlack.toFixed(0)}`,
  );
  if (m.minGapSlack < 0) console.log(`       - roads too close near ${m.gapAt}`);
  if (m.minRSlack < 0) console.log(`       - corner too tight near ${m.rAt}`);
  if (!m.ok) bad++;
}
process.exit(bad ? 1 : 0);
