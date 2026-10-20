import { GHOST_STRIDE, q1, type GhostData } from '../game/ghost';
import { firebaseConfigured, getFirebase } from './firebase';

/** The fastest uploaded replay for a track, with who set it. */
export interface OnlineGhost {
  uid: string;
  name: string;
  ghost: GhostData;
}

const MAX_CHARS = 600_000; // keep in step with firestore.rules

/**
 * Replays are stored as one string of delta-encoded integers (x and y in tenths of a pixel, heading in
 * thousandths of a radian, progress as-is), which is a small fraction of the size of the raw JSON.
 */
export function encodeFrames(frames: number[]): string {
  const prev = [0, 0, 0, 0];
  const out: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    const c = i % GHOST_STRIDE;
    const v = Math.round(c < 2 ? frames[i] * 10 : c === 2 ? frames[i] * 1000 : frames[i]);
    out.push(v - prev[c]);
    prev[c] = v;
  }
  return out.join(',');
}

export function decodeFrames(data: string): number[] | null {
  const parts = data.split(',');
  if (parts.length < GHOST_STRIDE * 2 || parts.length % GHOST_STRIDE !== 0) return null;
  const prev = [0, 0, 0, 0];
  const out: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const c = i % GHOST_STRIDE;
    const d = Number(parts[i]);
    if (!Number.isFinite(d)) return null;
    prev[c] += d;
    out.push(c < 2 ? q1(prev[c] / 10) : c === 2 ? prev[c] / 1000 : prev[c]);
  }
  return out;
}

// Pressing R restarts the race and reloads the scene, which used to download the top replay again every time.
// Keep it for a few minutes instead (each download is a read, and replays are the biggest documents we have).
const TOP_TTL_MS = 5 * 60_000;
const topCache = new Map<string, { at: number; ghost: OnlineGhost | null }>();
/** Boards whose replay backfill has already been checked this session. */
const synced = new Set<string>();

/** Writes this player's replay. The security rules only accept it if its time matches their leaderboard score. */
export async function uploadGhost(board: string, name: string, g: GhostData): Promise<boolean> {
  const data = encodeFrames(g.frames);
  if (data.length > MAX_CHARS) return false;
  const { db, uid, fs } = await getFirebase();
  await fs.setDoc(fs.doc(db, 'boards', board, 'ghosts', uid), {
    uid, name, time: Math.round(g.time * 1000), carId: g.carId, data, updatedAt: fs.serverTimestamp(),
  });
  topCache.delete(board); // it may be the new fastest
  return true;
}

/**
 * Backfill: if the player's saved local ghost is the run behind their leaderboard score but no replay is
 * online for it, upload it. Cheap (two reads) and silent on any failure.
 */
export async function syncGhost(board: string, name: string, local: GhostData): Promise<void> {
  if (!firebaseConfigured || !name) return;
  const key = `${board}:${local.time}`;
  if (synced.has(key)) return;
  synced.add(key);
  try {
    const { db, uid, fs } = await getFirebase();
    const ms = Math.round(local.time * 1000);
    const score = await fs.getDoc(fs.doc(db, 'boards', board, 'scores', uid));
    if (!score.exists() || score.data().value !== ms) return;
    const ghost = await fs.getDoc(fs.doc(db, 'boards', board, 'ghosts', uid));
    if (ghost.exists() && (ghost.data().time as number) <= ms) return;
    await uploadGhost(board, name, local);
  } catch {
    /* offline or rules not deployed: nothing to do */
  }
}

/** The fastest replay anyone has uploaded for this track; null if there isn't one yet; 'error' if we couldn't reach the server. */
export async function fetchTopGhost(board: string): Promise<OnlineGhost | null | 'error'> {
  if (!firebaseConfigured) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'error';
  const hit = topCache.get(board);
  if (hit && Date.now() - hit.at < TOP_TTL_MS) return hit.ghost;
  try {
    const { db, fs } = await getFirebase();
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'boards', board, 'ghosts'), fs.orderBy('time', 'asc'), fs.limit(1)));
    const d = snap.docs[0]?.data();
    const frames = d ? decodeFrames(String(d.data)) : null;
    const ghost = d && frames
      ? { uid: String(d.uid), name: String(d.name), ghost: { time: (d.time as number) / 1000, carId: String(d.carId), frames } }
      : null;
    topCache.set(board, { at: Date.now(), ghost });
    return ghost;
  } catch {
    return 'error';
  }
}
