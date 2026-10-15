const KEY = 'oversteer.records.v1';

interface Store {
  tracks: Record<string, { best?: number; bestLap?: number }>;
  endless?: number;
  oversteer?: number;
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* storage unavailable */
  }
  return { tracks: {} };
}

function save(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function formatTime(sec: number): string {
  const ms = Math.floor(sec * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

/** Compact m:ss.cc for the HUD. */
export function formatClock(sec: number): string {
  const cs = Math.floor(sec * 100);
  return `${Math.floor(cs / 6000)}:${String(Math.floor((cs % 6000) / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

export function getRecord(id: string): { best?: number; bestLap?: number } {
  return load().tracks[id] ?? {};
}

export function submitRace(id: string, total: number, bestLap: number): { newBest: boolean; newLap: boolean } {
  const s = load();
  const r = (s.tracks[id] ??= {});
  const newBest = r.best === undefined || total < r.best;
  const newLap = r.bestLap === undefined || bestLap < r.bestLap;
  if (newBest) r.best = total;
  if (newLap) r.bestLap = bestLap;
  save(s);
  return { newBest, newLap };
}

export type DistanceMode = 'endless' | 'oversteer';

export function getEndlessBest(mode: DistanceMode = 'endless'): number {
  return load()[mode] ?? 0;
}

export function submitEndless(meters: number, mode: DistanceMode = 'endless'): boolean {
  const s = load();
  if (meters <= (s[mode] ?? 0)) return false;
  s[mode] = meters;
  save(s);
  return true;
}
