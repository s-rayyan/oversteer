// Pure data: one-off goals that pay coins. Each is checked against what happened in the current run.

export interface RunStats {
  mode: 'race' | 'endless' | 'oversteer';
  /** Endless/OVERSTEER on the daily road. */
  daily: boolean;
  trackId: string;
  carId: string;
  /** Seconds of racing so far. */
  seconds: number;
  /** Endless/OVERSTEER distance. */
  meters: number;
  /** A circuit race has been finished. */
  finished: boolean;
  /** Medal won in a finished race: 0 none, 1 bronze, 2 silver, 3 gold. */
  medal: number;
  bestChain: number;
  gates: number;
  driftGates: number;
  copsShaken: number;
  closeCalls: number;
  cones: number;
  /** Wanted level reached (endless). */
  stars: number;
}

export const freshRun = (): RunStats => ({
  mode: 'race', daily: false, trackId: '', carId: '', seconds: 0, meters: 0, finished: false, medal: 0,
  bestChain: 0, gates: 0, driftGates: 0, copsShaken: 0, closeCalls: 0, cones: 0, stars: 1,
});

export interface Challenge {
  id: string;
  title: string;
  reward: number;
  test: (s: RunStats) => boolean;
}

export const CHALLENGES: Challenge[] = [
  { id: 'drift-25', title: 'Bank a 25-coin drift', reward: 60, test: (s) => s.bestChain >= 25 },
  { id: 'drift-60', title: 'Bank a 60-coin drift', reward: 150, test: (s) => s.bestChain >= 60 },
  { id: 'drift-120', title: 'Bank a 120-coin drift', reward: 400, test: (s) => s.bestChain >= 120 },
  { id: 'medal-any', title: 'Win any medal in a race', reward: 80, test: (s) => s.finished && s.medal >= 1 },
  { id: 'medal-gold', title: 'Win a gold medal', reward: 250, test: (s) => s.finished && s.medal >= 3 },
  { id: 'hatch-silver', title: 'Silver or better in the starter Hatchback', reward: 150, test: (s) => s.finished && s.carId === 'hatch' && s.medal >= 2 },
  { id: 'kart-alley', title: 'Silver on Hairpin Alley in the Go-Kart', reward: 300, test: (s) => s.finished && s.trackId === 'hairpin-alley' && s.carId === 'kart' && s.medal >= 2 },
  { id: 'endless-1k', title: 'Reach 1000 m in Endless', reward: 150, test: (s) => s.mode === 'endless' && !s.daily && s.meters >= 1000 },
  { id: 'endless-3k', title: 'Reach 3000 m in Endless', reward: 400, test: (s) => s.mode === 'endless' && !s.daily && s.meters >= 3000 },
  { id: 'oversteer-2m', title: 'Survive 2 minutes in OVERSTEER', reward: 200, test: (s) => s.mode === 'oversteer' && s.seconds >= 120 },
  { id: 'spin-3', title: 'Spin out 3 cruisers in one run', reward: 150, test: (s) => s.copsShaken >= 3 },
  { id: 'gates-5', title: 'Drift through 5 gates in one run', reward: 150, test: (s) => s.driftGates >= 5 },
  { id: 'close-5', title: 'Get 5 close calls in one run', reward: 100, test: (s) => s.closeCalls >= 5 },
  { id: 'cones-10', title: 'Smash 10 cones in one run', reward: 80, test: (s) => s.cones >= 10 },
  { id: 'wanted-4', title: 'Reach wanted level 4', reward: 200, test: (s) => s.stars >= 4 },
  { id: 'daily-500', title: 'Drive 500 m on the daily road', reward: 100, test: (s) => s.daily && s.meters >= 500 },
];
