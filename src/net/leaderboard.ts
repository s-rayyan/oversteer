import { formatTime, getLocalBests, getUploadQueue, markUploaded, queueUpload } from '../game/records';
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

/** Best single lap on a track lives on its own board, `lap:{trackId}` (milliseconds, lower is better). */
export const lapBoard = (trackId: string): string => `lap:${trackId}`;

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
  markUploaded(board, best);
  return { improved, best, rank };
}

const cache = new Map<string, { at: number; rows: ScoreRow[] }>();

export async function fetchTop(board: string, n = 10): Promise<{ rows: ScoreRow[]; myUid: string }> {
  const { db, uid, fs } = await getFirebase();
  const hit = cache.get(board);
  if (hit && Date.now() - hit.at < 60_000) return { rows: hit.rows, myUid: uid };

  // Fetch a few extra so the board still fills up after duplicates are dropped (each document read counts
  // against the daily quota, so not too many).
  const q = fs.query(
    fs.collection(db, 'boards', board, 'scores'),
    fs.orderBy('value', higherIsBetter(board) ? 'desc' : 'asc'),
    fs.limit(n * 2),
  );
  const snap = await fs.getDocs(q);
  const rows = dedupeByName(snap.docs.map((d) => d.data() as ScoreRow), uid).slice(0, n);
  cache.set(board, { at: Date.now(), rows });
  return { rows, myUid: uid };
}

/**
 * One player can have several scores under the same name (a different uid per browser or device).
 * Rows arrive best-first, so keeping the first row per name keeps that player's top score. If one of the
 * dropped rows is this player's, the kept row takes their uid so it is still highlighted as theirs.
 */
function dedupeByName(rows: ScoreRow[], myUid: string): ScoreRow[] {
  const kept = new Map<string, ScoreRow>();
  for (const row of rows) {
    const key = row.name.trim().toLowerCase();
    const best = kept.get(key);
    if (!best) kept.set(key, { ...row });
    else if (row.uid === myUid) best.uid = myUid;
  }
  return [...kept.values()];
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
    const boards = [...TRACKS.map((t) => t.id), ...TRACKS.map((t) => lapBoard(t.id)), BOARD_ENDLESS, BOARD_OVERSTEER];
    for (const board of boards) {
      const ref = fs.doc(db, 'boards', board, 'scores', uid);
      const snap = await fs.getDoc(ref);
      if (!snap.exists()) continue;
      if (snap.data().name !== name) await fs.updateDoc(ref, { name, updatedAt: fs.serverTimestamp() });
      if (board === BOARD_ENDLESS || board === BOARD_OVERSTEER || board.startsWith('lap:')) continue;
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
// Runs set without a connection (or when the submit failed) wait in the upload queue in records.ts, which only
// ever holds runs driven on this device. Best times merged in from another save are not posted from here.

/**
 * One-time move from the old bookkeeping (which bests the board had confirmed): queue the local bests it hadn't
 * confirmed yet, but only if it was tracking this same account, so times copied in from elsewhere stay out.
 */
async function migrateSynced(): Promise<void> {
  let old: { uid?: string; boards?: Record<string, number> } | null = null;
  try {
    const raw = localStorage.getItem(LB_SYNCED_KEY);
    if (raw === null) return;
    old = JSON.parse(raw);
  } catch {
    /* storage unavailable or corrupt */
  }
  const { uid } = await getFirebase();
  if (old?.uid === uid) {
    for (const { board, value } of getLocalBests()) {
      const seen = old.boards?.[board];
      if (seen === undefined || (higherIsBetter(board) ? value > seen : value < seen)) queueUpload(board, value);
    }
  }
  try { localStorage.removeItem(LB_SYNCED_KEY); } catch { /* storage unavailable */ }
}

let syncing = false;
let again = false;

/** Posts every run from this device the leaderboard hasn't confirmed yet. Safe to call often; failures just wait for next time. */
export async function syncLocalBests(): Promise<void> {
  const name = getName();
  try {
    const pending = localStorage.getItem(RENAME_KEY);
    if (pending && pending === name && !syncing) void renameEverywhere(name);
  } catch {
    /* storage unavailable */
  }
  if (!firebaseConfigured || !name || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  if (syncing) {
    again = true; // a run set while this one is posting still goes up, right after
    return;
  }
  syncing = true;
  try {
    await migrateSynced();
    const pending = Object.entries(getUploadQueue())
      .filter(([board, value]) => !((board === BOARD_ENDLESS || board === BOARD_OVERSTEER) && value < 30)); // same cut-off as EndlessScene
    for (const [board, value] of pending) {
      try {
        await submitScore(board, name, value);
      } catch (e) {
        // The rules turned this score down for good (e.g. faster than a believable time): stop retrying it on every
        // start, and carry on with the other boards. Anything else (offline...) stays queued for next time.
        if ((e as { code?: string }).code === 'permission-denied') markUploaded(board, value);
        else throw e;
      }
    }
  } catch {
    /* offline: try again later */
  } finally {
    syncing = false;
    if (again) {
      again = false;
      void syncLocalBests();
    }
  }
}
