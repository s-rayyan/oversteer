// Which game the player picked on the launch screen: the classic top-down 2D game or the 3D one. The 3D game uses
// the same tracks, cars, coins and garage, but keeps its own records, ghosts and leaderboards: every 3D board and
// record id is the track id with a `3d:` prefix (`3d:sunset-oval`, and `lap:3d:sunset-oval` for its best lap).

export type Dim = '2d' | '3d';

const KEY = 'oversteer.dim';
let current: Dim = '2d';

/** The game picked last time (the launch screen starts on it), or 2D for a new player. */
export function lastDim(): Dim {
  try {
    return localStorage.getItem(KEY) === '3d' ? '3d' : '2d';
  } catch {
    return '2d';
  }
}

export const getDim = (): Dim => current;
export const is3D = (): boolean => current === '3d';

export function setDim(d: Dim): void {
  current = d;
  try {
    localStorage.setItem(KEY, d);
  } catch {
    /* storage unavailable */
  }
}

export const PREFIX_3D = '3d:';

/** Record, ghost and leaderboard id of a track in the current game. */
export const recordId = (trackId: string, d: Dim = current): string => (d === '3d' ? PREFIX_3D + trackId : trackId);

/** The track id inside a record id (`3d:sunset-oval` -> `sunset-oval`). */
export const baseTrackId = (id: string): string => (id.startsWith(PREFIX_3D) ? id.slice(PREFIX_3D.length) : id);
