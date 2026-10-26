// Simulates a car driving a circle, sent 10 times a second over a jittery network, and checks that the drawn car
// never jumps backwards or forwards. Compares the old "chase the last update with a guessed velocity" method.
//   npm run test:interp
import { SnapshotBuffer } from '../src/game/netInterp.ts';

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const R = 300, W = 0.6; // metres of circle, rad/s: ~180 units/s
const truth = (ms: number) => ({ x: R * Math.cos((W * ms) / 1000), y: R * Math.sin((W * ms) / 1000) });

interface Pkt { sendT: number; arrive: number }
const pkts: Pkt[] = [];
for (let t = 0; t < 20000; t += 100) pkts.push({ sendT: t, arrive: t + 40 + rnd() * 140 }); // 40-180 ms trip
// Real networks also deliver in bursts: squash some pairs together.
for (let i = 5; i < pkts.length - 1; i += 11) pkts[i].arrive = Math.max(pkts[i].arrive, pkts[i + 1].arrive - 2); // the earlier one is held up and arrives with the next
pkts.sort((a, b) => a.arrive - b.arrive);

const CLOCK_SKEW = 123456; // the sender's clock is nowhere near ours

function run(name: string): void {
  let idx = 0;
  const buf = new SnapshotBuffer();
  let prev: { x: number; y: number } | null = null;
  let worstBack = 0, worstJump = 0, errSum = 0, n = 0;
  const speed = R * W;
  for (let now = 0; now < 20000; now += 16) {
    while (idx < pkts.length && pkts[idx].arrive <= now) {
      const p = pkts[idx++];
      const tr = truth(p.sendT);
      buf.add({ t: p.sendT + CLOCK_SKEW, x: tr.x, y: tr.y, h: 0 }, now + CLOCK_SKEW + 0);
    }
    const s = buf.sample(now + CLOCK_SKEW);
    if (!s || now < 2000) { prev = s; continue; }
    if (prev) {
      // motion along the direction of travel this frame: should be ~ speed*16ms, never negative
      const tx = -Math.sin((W * now) / 1000), ty = Math.cos((W * now) / 1000);
      const along = (s.x - prev.x) * tx + (s.y - prev.y) * ty;
      worstBack = Math.min(worstBack, along);
      worstJump = Math.max(worstJump, along);
    }
    const t = truth(now);
    errSum += Math.hypot(s.x - t.x, s.y - t.y);
    n++;
    prev = s;
  }
  console.log(`${name}: biggest step back ${worstBack.toFixed(2)}, biggest step forward ${worstJump.toFixed(2)} (a normal frame is ${((speed * 16) / 1000).toFixed(2)}), avg behind-real-time ${(errSum / n / speed * 1000).toFixed(0)} ms`);
  if (worstBack < -0.5 || worstJump > (speed * 16) / 1000 * 2.5) { console.error('FAIL: the car jumps'); process.exitCode = 1; }
}

run('snapshot interpolation');

// The previous method, for comparison: chase the last update, extrapolating on a velocity estimated from arrival times.
{
  let idx = 0;
  let tx = 0, ty = 0, vx = 0, vy = 0, seenAt = 0, seen = false, ox = 0, oy = 0;
  let prev: { x: number; y: number } | null = null;
  let worstBack = 0, worstJump = 0;
  const speed = R * W;
  for (let now = 0; now < 20000; now += 16) {
    while (idx < pkts.length && pkts[idx].arrive <= now) {
      const p = pkts[idx++], tr = truth(p.sendT);
      if (seen) { const dt = Math.max(0.05, (now - seenAt) / 1000); vx = (tr.x - tx) / dt; vy = (tr.y - ty) / dt; } else { ox = tr.x; oy = tr.y; seen = true; }
      tx = tr.x; ty = tr.y; seenAt = now;
    }
    if (!seen) continue;
    const age = Math.min((now - seenAt) / 1000, 0.3), k = 1 - Math.exp(-14 * 0.016);
    ox += (tx + vx * age - ox) * k; oy += (ty + vy * age - oy) * k;
    if (prev && now > 2000) {
      const ux = -Math.sin((W * now) / 1000), uy = Math.cos((W * now) / 1000);
      const along = (ox - prev.x) * ux + (oy - prev.y) * uy;
      worstBack = Math.min(worstBack, along); worstJump = Math.max(worstJump, along);
    }
    prev = { x: ox, y: oy };
  }
  console.log(`old method: biggest step back ${worstBack.toFixed(2)}, biggest step forward ${worstJump.toFixed(2)} (a normal frame is ${((speed * 16) / 1000).toFixed(2)})`);
}
