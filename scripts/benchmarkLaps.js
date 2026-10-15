// Checks that the REAL game and the headless simulator agree.
// Paste this whole file into the browser console of the running game (npm run dev).
// For a spread of tracks and cars it laps in the game with the same bot the simulator uses and compares
// each lap time with scripts/benchmarkLaps.json (produced by `npm run benchmark -- --write`).
(async () => {
  const cars = await import('/src/game/cars.ts');
  const game = window.__game; // exposed in dev builds
  const expected = await (await fetch('/scripts/benchmarkLaps.json')).json();
  localStorage.setItem('oversteer.player', 'bot'); // so no name prompt appears

  async function lap(trackId, car) {
    game.loop.wake();
    game.scene.getScenes(true).forEach((s) => game.scene.stop(s.scene.key));
    await new Promise((r) => setTimeout(r, 150));
    game.scene.start('RaceScene', { trackId });
    await new Promise((r) => setTimeout(r, 500));
    const s = game.scene.getScene('RaceScene');
    s.submitOnline = async () => {}; // never post bot runs to the leaderboard
    const stats = cars.effectiveStats(car, { engine: 0, tires: 0, turbo: 0 });
    s.car.phys.stats = stats; s.stats = stats;
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

  const pairs = [
    ['sunset-oval', 'hatch'], ['spaghetti', 'phantom'], ['switchbacks', 'legend'],
    ['hairpin-alley', 'kart'], ['gravel-rally', 'tank'], ['gravel-rally', 'rocket'], ['boost-highway', 'bruiser'],
    ['boost-highway', 'rocket'], ['drift-ring', 'drifter'], ['drift-ring', 'dragster'], ['grand-tour', 'coupe'], ['razor', 'comet'],
  ];
  let bad = 0;
  for (const [tr, id] of pairs) {
    const got = await lap(tr, cars.CARS.find((c) => c.id === id));
    const want = expected[tr][id];
    const ok = got !== null && Math.abs(got - want) <= 0.06;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${tr}/${id}: game ${got}  simulator ${want}`);
  }
  localStorage.clear(); // the bot earned coins in this browser
  console.log(bad ? `DONE: ${bad} mismatches` : 'DONE: the game and the simulator agree on every lap');
})();
