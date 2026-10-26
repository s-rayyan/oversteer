import { getName } from '../game/player';
import { selectedCar } from '../game/profile';
import { getRealtime, realtimeConfigured } from './firebase';
import { pvp, pvpAvailable, pvpIsLocal } from './pvp';

/**
 * Who is online, and challenges. Both live in the Realtime Database (billed by bandwidth, and it can drop a record
 * the moment a tab closes): `presence/{uid}` is one small record per online player, and `challenges/{target}/{from}`
 * is an invitation to a private room. Without a Realtime Database URL there is no presence, so these pages are
 * hidden; with `?pvp=local` on a dev build the same interface runs on localStorage for two tabs of one browser.
 */

export type Status = 'menu' | 'lobby' | 'racing';

export interface Presence {
  uid: string;
  name: string;
  carId: string;
  st: Status;
  /** When the player last checked in (ms since epoch). */
  at: number;
}

export interface Challenge {
  /** The challenger's uid. */
  from: string;
  name: string;
  /** The private room they are waiting in. */
  room: string;
  track: string;
  at: number;
}

/** A player counts as online if they have checked in this recently. */
export const ONLINE_MS = 75_000;
const BEAT_MS = 20_000;
/** A challenge older than this is ignored (the room it points to has probably timed out). */
const CHALLENGE_MS = 3 * 60_000;
/** Don't let one player flood another with invitations. */
const CHALLENGE_COOLDOWN_MS = 20_000;

export const socialAvailable = (): boolean => pvpAvailable() && (pvpIsLocal() || realtimeConfigured);

// ---- dev: two tabs through localStorage (polled, so a tab sees the other one's changes) ----

const P = 'oversteer.social.';
const lsGet = <T>(key: string): T | null => {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; } catch { return null; }
};
const lsKeys = (prefix: string): string[] => {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(prefix)) out.push(k);
  }
  return out;
};

// ---- presence ----

let beatTimer = 0;
let lastStatus: () => Status = () => 'menu';

/** Checks in now (and keeps checking in) so other players see us as online. Safe to call repeatedly. */
export function startPresence(status: () => Status): void {
  lastStatus = status;
  if (!socialAvailable() || beatTimer) return;
  const beat = () => void announce().catch(() => undefined);
  beatTimer = window.setInterval(beat, BEAT_MS);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') beat(); });
  beat();
}

/** Writes our presence record immediately, e.g. when a page that lists players opens. */
export async function announce(): Promise<void> {
  const name = getName();
  if (!name || !socialAvailable()) return;
  const uid = await pvp().uid();
  const car = selectedCar().id;
  const st = lastStatus();
  if (pvpIsLocal()) {
    localStorage.setItem(`${P}presence.${uid}`, JSON.stringify({ uid, name, carId: car, st, at: Date.now() } satisfies Presence));
    return;
  }
  const { rtdb, rt } = await getRealtime();
  const ref = rt.ref(rtdb, `presence/${uid}`);
  void rt.onDisconnect(ref).remove().catch(() => undefined); // closing the tab takes us off the list straight away
  await rt.set(ref, { name, car, st, at: rt.serverTimestamp() });
}

/** Calls `cb` with everyone else who is online, now and whenever it changes. Returns a function that stops it. */
export function watchOnline(cb: (players: Presence[]) => void): () => void {
  let stop = false;
  let off: (() => void) | null = null;
  let timer = 0;
  void pvp().uid().then((me) => {
    if (stop) return;
    const emit = (all: Presence[]) => {
      const now = Date.now();
      cb(all.filter((p) => p.uid !== me && now - p.at < ONLINE_MS).sort((a, b) => a.name.localeCompare(b.name)));
    };
    if (pvpIsLocal()) {
      const read = () => emit(lsKeys(`${P}presence.`).map((k) => lsGet<Presence>(k)).filter((p): p is Presence => !!p));
      timer = window.setInterval(read, 1500);
      read();
      return;
    }
    void getRealtime().then(({ rtdb, rt }) => {
      if (stop) return;
      let latest: Presence[] = [];
      const unsub = rt.onValue(rt.ref(rtdb, 'presence'), (snap) => {
        latest = [];
        snap.forEach((child) => {
          const v = child.val() as { name?: string; car?: string; st?: Status; at?: number } | null;
          if (child.key && v && typeof v.name === 'string') latest.push({ uid: child.key, name: v.name, carId: v.car ?? '', st: v.st ?? 'menu', at: typeof v.at === 'number' ? v.at : 0 });
        });
        emit(latest);
      }, () => cb([]));
      // Someone who closed their tab uncleanly never sends a removal, so stale entries are filtered out on a timer too.
      timer = window.setInterval(() => emit(latest), 10_000);
      off = unsub;
    }).catch(() => cb([]));
  }).catch(() => cb([]));
  return () => { stop = true; off?.(); clearInterval(timer); };
}

// ---- challenges ----

const lastSent = new Map<string, number>();

/** Opens a private room on `trackId`, invites `target` into it, and returns the room code (we are already inside). */
export async function challengePlayer(target: string, trackId: string): Promise<string> {
  const last = lastSent.get(target) ?? 0;
  if (Date.now() - last < CHALLENGE_COOLDOWN_MS) throw new Error('cooldown');
  const me = { name: getName(), carId: selectedCar().id, at: Date.now() };
  const room = await pvp().create(trackId, false, me);
  const uid = await pvp().uid();
  if (pvpIsLocal()) {
    localStorage.setItem(`${P}chal.${target}.${uid}`, JSON.stringify({ from: uid, name: me.name, room, track: trackId, at: Date.now() } satisfies Challenge));
  } else {
    const { rtdb, rt } = await getRealtime();
    await rt.set(rt.ref(rtdb, `challenges/${target}/${uid}`), { name: me.name, room, track: trackId, at: rt.serverTimestamp() });
  }
  lastSent.set(target, Date.now());
  return room;
}

/** Throws the invitation from `from` away (accepting it or turning it down). */
export async function clearChallenge(from: string): Promise<void> {
  const me = await pvp().uid();
  if (pvpIsLocal()) {
    localStorage.removeItem(`${P}chal.${me}.${from}`);
    return;
  }
  const { rtdb, rt } = await getRealtime();
  await rt.remove(rt.ref(rtdb, `challenges/${me}/${from}`));
}

/** Calls `cb` once for each fresh invitation sent to us, including one that arrived while we were away. */
export function watchChallenges(cb: (c: Challenge) => void): () => void {
  let stop = false;
  let off: (() => void) | null = null;
  let timer = 0;
  const fresh = (c: Challenge) => Date.now() - c.at < CHALLENGE_MS;
  void pvp().uid().then((me) => {
    if (stop) return;
    if (pvpIsLocal()) {
      const seen = new Set<string>();
      const read = () => {
        for (const k of lsKeys(`${P}chal.${me}.`)) {
          const c = lsGet<Challenge>(k);
          if (c && fresh(c) && !seen.has(`${c.from}${c.room}`)) { seen.add(`${c.from}${c.room}`); cb(c); }
        }
      };
      timer = window.setInterval(read, 1500);
      read();
      return;
    }
    void getRealtime().then(({ rtdb, rt }) => {
      if (stop) return;
      off = rt.onChildAdded(rt.ref(rtdb, `challenges/${me}`), (snap) => {
        const v = snap.val() as { name?: string; room?: string; track?: string; at?: number } | null;
        if (!snap.key || !v || typeof v.room !== 'string') return;
        const c: Challenge = { from: snap.key, name: String(v.name ?? '???'), room: v.room, track: String(v.track ?? ''), at: typeof v.at === 'number' ? v.at : Date.now() };
        if (fresh(c)) cb(c);
        else void clearChallenge(c.from).catch(() => undefined); // an old invitation nobody will answer
      }, () => undefined);
    }).catch(() => undefined);
  }).catch(() => undefined);
  return () => { stop = true; off?.(); clearInterval(timer); };
}
