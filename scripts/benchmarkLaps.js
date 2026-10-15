// Lap-time benchmark: a self-driving bot laps every track with every car, using the real game physics.
// It produces scripts/benchmarkLaps.json, which `npm run check:trackclasses` checks the track-class
// recommendations against. Re-run it after changing car stats or tracks.
//
// How to run: start the dev server (npm run dev), open the game, then paste this whole file into the
// browser console. When it logs "DONE", copy the JSON it prints into scripts/benchmarkLaps.json.
//
// Caveats: the bot follows the road line, boosts on straights and uses the handbrake in tight corners.
// It does not drift for boost or cut across grass, so it measures clean-racing pace, not skilled play.
(async () => {
  const cars = await import('/src/game/cars.ts');
  const tracks = await import('/src/game/tracks.ts');
  const game = window.__game; // exposed in dev builds
  localStorage.setItem('oversteer.player', 'bot'); // so no name prompt appears

  async function lap(trackId, car) {
    game.loop.wake();
    game.scene.getScenes(true).forEach((s) => game.scene.stop(s.scene.key));
    await new Promise((r) => setTimeout(r, 120));
    game.scene.start('RaceScene', { trackId });
    await new Promise((r) => setTimeout(r, 500));
    const s = game.scene.getScene('RaceScene');
    s.submitOnline = async () => {}; // never post benchmark runs to the leaderboard
    const stats = cars.effectiveStats(car, { engine: 0, tires: 0, turbo: 0 });
    s.car.stats = stats; s.stats = stats;
    game.loop.sleep(); // step the scene by hand, deterministically (50 ms per step)
    s.state = 'racing'; s.countdown = 0; s.paused = false; s.boost = 0; s.raceTime = 0;
    const K = s.keys, down = (k, v) => { K[k].isDown = v; };
    let t = 0;
    while (s.lapTimes.length < 1 && t < 200) {
      const sp = s.car.speed, look = Math.max(12, Math.min(40, Math.round(10 + sp * 0.12)));
      const aim = s.samples[(s.idx + look) % s.samples.length];
      const want = Math.atan2(aim.y - s.car.y, aim.x - s.car.x);
      const d = Math.atan2(Math.sin(want - s.car.facing), Math.cos(want - s.car.facing)), ad = Math.abs(d);
      down('left', d < -0.04); down('right', d > 0.04);
      down('up', !(ad > 0.6 && sp > 85)); down('down', ad > 1.1 && sp > 60);
      down('space', ad < 0.25 && s.boost > 0.05); down('comma', ad > 0.8 && sp > 70);
      s.update(0, 50); t += 0.05;
    }
    game.loop.wake();
    return s.lapTimes[0] ? +s.lapTimes[0].toFixed(2) : null;
  }

  const out = {};
  for (const tr of tracks.TRACKS) {
    out[tr.id] = {};
    for (const car of cars.CARS) out[tr.id][car.id] = await lap(tr.id, car);
    console.log('lapped', tr.name);
  }
  localStorage.clear(); // the bot earned coins and records in this browser
  console.log('DONE\n' + JSON.stringify(out));
})();
