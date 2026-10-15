import { formatTime } from '../game/records';
import { getFirebase } from './firebase';

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
