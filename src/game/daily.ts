// The daily road: everybody gets the same endless road on the same (UTC) day. Its best distances are kept on this
// device only; the online boards have no daily board, and daily runs stay off the endless boards so that a road
// everyone can practise can't be used to set a global record.
import type { DistanceMode } from './records';

const KEY = 'oversteer.daily.v1';

interface Store {
  date: string;
  endless: number;
  oversteer: number;
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Road seed for today, the same for every player. */
export const dailySeed = (): string => 'D' + today().replace(/-/g, '');

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as Store;
      if (s.date === today()) return s;
    }
  } catch {
    /* unreadable: start the day fresh */
  }
  return { date: today(), endless: 0, oversteer: 0 };
}

export function getDailyBest(mode: DistanceMode): number {
  return load()[mode] ?? 0;
}

/** Records today's distance if it is a new best for today; returns true when it was. */
export function submitDaily(meters: number, mode: DistanceMode): boolean {
  const s = load();
  if (meters <= s[mode]) return false;
  s[mode] = meters;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
  return true;
}
