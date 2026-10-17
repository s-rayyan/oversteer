/** Ghost replays: your best run per track, stored locally as fixed-rate frames. */
export const GHOST_DT = 0.05; // seconds between recorded frames
export const GHOST_STRIDE = 4; // numbers per frame: x, y, heading, progress (samples past the start line)

export interface GhostData {
  time: number; // total race time, seconds
  carId: string;
  frames: number[]; // flat [x, y, heading, progress, ...]
}

const key = (trackId: string) => `oversteer.ghost.v2.${trackId}`;

export function loadGhost(trackId: string): GhostData | null {
  try {
    const raw = localStorage.getItem(key(trackId));
    if (!raw) return null;
    const g = JSON.parse(raw) as GhostData;
    return Array.isArray(g.frames) && g.frames.length >= GHOST_STRIDE * 2 ? g : null;
  } catch {
    return null;
  }
}

/** Saves the run if it beats the stored ghost (or none exists). Returns true when saved. */
export function saveGhostIfBest(trackId: string, run: GhostData): boolean {
  const old = loadGhost(trackId);
  if (old && old.time <= run.time) return false;
  try {
    localStorage.setItem(key(trackId), JSON.stringify(run));
    return true;
  } catch {
    return false; // storage full or unavailable
  }
}

/** Which replays race alongside you: your best run (default), the fastest online run, both, or none. */
export type GhostMode = 'mine' | 'top' | 'both' | 'off';
export const GHOST_MODES: GhostMode[] = ['mine', 'top', 'both', 'off'];
export const GHOST_MODE_LABEL: Record<GhostMode, string> = { mine: 'MY BEST', top: 'TOP PLAYER', both: 'MY BEST + TOP', off: 'OFF' };

const MODE_KEY = 'oversteer.ghostmode.v1';

export function getGhostMode(): GhostMode {
  try {
    const m = localStorage.getItem(MODE_KEY) as GhostMode | null;
    if (m && GHOST_MODES.includes(m)) return m;
  } catch {
    /* storage unavailable */
  }
  return 'mine';
}

export function setGhostMode(m: GhostMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage unavailable */
  }
}

export const q1 = (v: number): number => Math.round(v * 10) / 10;
