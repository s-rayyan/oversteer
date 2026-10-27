import { saveChanged } from './cloudHook';

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
  saveChanged();
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
  if (newBest) queueUpload(id, Math.round(total * 1000));
  if (newLap) queueUpload(`lap:${id}`, Math.round(bestLap * 1000));
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
  queueUpload(mode, meters);
  return true;
}

// ---------- runs waiting for the leaderboard ----------
// Only runs driven on this device go here. Best times that arrive by merging another save (moving out of the
// hub iframe, signing in to an account) were set, and uploaded, by that other save: re-uploading them would
// put the same run on the board twice under two accounts. Device-only: never transferred or merged.

export const UPLOAD_QUEUE_KEY = 'oversteer.lbPending';

const higherWins = (board: string) => board === 'endless' || board === 'oversteer';

export function getUploadQueue(): Record<string, number> {
  try {
    const raw = localStorage.getItem(UPLOAD_QUEUE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, number>;
  } catch {
    /* storage unavailable or corrupt */
  }
  return {};
}

function writeQueue(q: Record<string, number>): void {
  try {
    localStorage.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable */
  }
}

/** Remembers a run set here so it is posted even if this attempt is offline. */
export function queueUpload(board: string, value: number): void {
  const q = getUploadQueue();
  const old = q[board];
  if (old === undefined || (higherWins(board) ? value > old : value < old)) q[board] = value;
  writeQueue(q);
}

/** The leaderboard now holds `value` (or better) for this board: drop anything queued that it covers. */
export function markUploaded(board: string, value: number): void {
  const q = getUploadQueue();
  const old = q[board];
  if (old === undefined || (higherWins(board) ? old > value : old < value)) return;
  delete q[board];
  writeQueue(q);
}

/** Every saved best lap as a lap-board entry (ms). */
export function getLocalBestLaps(): { board: string; value: number }[] {
  return Object.entries(load().tracks).filter(([, r]) => r.bestLap !== undefined).map(([id, r]) => ({ board: `lap:${id}`, value: Math.round((r.bestLap as number) * 1000) }));
}

/** Every local best as a leaderboard entry (race boards in ms, distance boards in metres). */
export function getLocalBests(): { board: string; value: number }[] {
  const s = load();
  const out: { board: string; value: number }[] = [];
  for (const [id, r] of Object.entries(s.tracks)) if (r.best !== undefined) out.push({ board: id, value: Math.round(r.best * 1000) });
  for (const mode of ['endless', 'oversteer'] as const) if ((s[mode] ?? 0) > 0) out.push({ board: mode, value: s[mode] as number });
  return out;
}
