import { formatTime, getLocalBests } from '../game/records';
import { getName } from '../game/player';
import { LB_SYNCED_KEY } from '../game/saveMerge';
import { firebaseConfigured, getFirebase } from './firebase';
import { TRACKS } from '../game/tracks';

export const BOARD_ENDLESS = 'endless';
export const BOARD_OVERSTEER = 'oversteer';

export interface ScoreRow {
  uid: string;
  name: string;
  value: number;
}

/** Race boards store milliseconds (lower is better); endless stores metres (higher is better). */
export const higherIsBetter = (board: string): boolean => board === BOARD_ENDLESS || board === BOARD_OVERSTEER;

export function formatScore(board: string, value: number): string {
  return higherIsBetter(board) ? `${value} m` : formatTime(value / 1000);
}

export interface SubmitResult {
  improved: boolean;
  best: number;
  rank?: number;
}

/** Writes the player's score only if it beats their stored one (or the name changed); returns global rank. */
export async function submitScore(board: string, name: string, value: number): Promise<SubmitResult> {
  const { db, uid, fs } = await getFirebase();
  const ref = fs.doc(db, 'boards', board, 'scores', uid);
  const snap = await fs.getDoc(ref);
  const old = snap.exists() ? (snap.data().value as number) : undefined;
  const improved = old === undefined || (higherIsBetter(board) ? value > old : value < old);
  const best = improved ? value : (old as number);

  if (improved || snap.data()?.name !== name) {
    await fs.setDoc(ref, { uid, name, value: best, updatedAt: fs.serverTimestamp() });
  }

  let rank: number | undefined;
  try {
    const better = fs.query(fs.collection(db, 'boards', board, 'scores'), fs.where('value', higherIsBetter(board) ? '>' : '<', best));
    rank = (await fs.getCountFromServer(better)).data().count + 1;
  } catch {
    /* rank is a nice-to-have */
  }
  cache.delete(board);
  markSynced(uid, board, best);
  return { improved, best, rank };
}

const cache = new Map<string, { at: number; rows: ScoreRow[] }>();

export async function fetchTop(board: string, n = 10): Promise<{ rows: ScoreRow[]; myUid: string }> {
  const { db, uid, fs } = await getFirebase();
  const hit = cache.get(board);
  if (hit && Date.now() - hit.at < 20_000) return { rows: hit.rows, myUid: uid };

  const q = fs.query(
    fs.collection(db, 'boards', board, 'scores'),
    fs.orderBy('value', higherIsBetter(board) ? 'desc' : 'asc'),
    fs.limit(n),
  );
  const snap = await fs.getDocs(q);
  const rows = snap.docs.map((d) => d.data() as ScoreRow);
  cache.set(board, { at: Date.now(), rows });
  return { rows, myUid: uid };
}

// ---------- renaming ----------
// Scores and replays carry the name they were set under, so changing your name has to rewrite them too.

const RENAME_KEY = 'oversteer.renamePending';

/** Rewrites the player's name on every board they have a score (and replay) on. Remembers to retry if it fails. */
export async function renameEverywhere(name: string): Promise<void> {
  if (!firebaseConfigured || !name) return;
  try { localStorage.setItem(RENAME_KEY, name); } catch { /* storage unavailable */ }
  try {
    const { db, uid, fs } = await getFirebase();
    const boards = [...TRACKS.map((t) => t.id), BOARD_ENDLESS, BOARD_OVERSTEER];
    for (const board of boards) {
      const ref = fs.doc(db, 'boards', board, 'scores', uid);
      const snap = await fs.getDoc(ref);
      if (!snap.exists()) continue;
      if (snap.data().name !== name) await fs.updateDoc(ref, { name, updatedAt: fs.serverTimestamp() });
      if (board === BOARD_ENDLESS || board === BOARD_OVERSTEER) continue;
      const gref = fs.doc(db, 'boards', board, 'ghosts', uid);
      const g = await fs.getDoc(gref);
      if (g.exists() && g.data().name !== name) await fs.updateDoc(gref, { name, updatedAt: fs.serverTimestamp() });
    }
    cache.clear();
    try { localStorage.removeItem(RENAME_KEY); } catch { /* storage unavailable */ }
  } catch {
    /* offline or rules rejected: stays pending and is retried by syncLocalBests */
  }
}

// ---------- offline catch-up ----------
// Scores set without a connection (or when the submit failed) are only in the local records. Remember which
// bests the leaderboard has confirmed, and post any local best that is better than that once we're online.

type Synced = { uid?: string; boards: Record<string, number> };

function readSynced(): Synced {
  try {
    const raw = localStorage.getItem(LB_SYNCED_KEY);
    if (raw) return JSON.parse(raw) as Synced;
  } catch {
    /* storage unavailable or corrupt */
  }
  return { boards: {} };
}

function markSynced(uid: string, board: string, value: number): void {
  const s = readSynced();
  if (s.uid !== uid) {
    s.uid = uid;
    s.boards = {};
  }
  s.boards[board] = value;
  try {
    localStorage.setItem(LB_SYNCED_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

let syncing = false;

/** Posts every local best the leaderboard hasn't confirmed yet. Safe to call often; failures just wait for next time. */
export async function syncLocalBests(): Promise<void> {
  const name = getName();
  try {
    const pending = localStorage.getItem(RENAME_KEY);
    if (pending && pending === name && !syncing) void renameEverywhere(name);
  } catch {
    /* storage unavailable */
  }
  if (syncing || !firebaseConfigured || !name || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  const done = readSynced().boards;
  const pending = getLocalBests().filter(({ board, value }) => {
    if ((board === BOARD_ENDLESS || board === BOARD_OVERSTEER) && value < 30) return false; // same cut-off as EndlessScene
    const seen = done[board];
    return seen === undefined || (higherIsBetter(board) ? value > seen : value < seen);
  });
  if (!pending.length) return;
  syncing = true;
  try {
    for (const { board, value } of pending) await submitScore(board, name, value);
  } catch {
    /* offline or rules rejected: try again later */
  } finally {
    syncing = false;
  }
}
