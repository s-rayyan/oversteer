import { firebaseConfigured, getFirebase } from './firebase';

/**
 * Head-to-head races. A room is one Firestore document (`rooms/{code}`) holding the roster, plus one small
 * `live` document per driver (`rooms/{code}/live/{uid}`) that each client rewrites a few times a second with its
 * car's position. Everyone watches the others' live documents and draws them as cars on their own screen, so the
 * races are not simulated on a server: each player drives their own car and the finish times are self-reported.
 *
 * With `?pvp=local` on a dev build the same interface runs on localStorage instead, so two browser tabs can race
 * each other without any Firebase project.
 */

export const ROOM_MAX = 4;
/** A driver who hasn't refreshed their lobby entry for this long is treated as gone. */
export const PRESENCE_MS = 25_000;
export const HEARTBEAT_MS = 8_000;
/** Public rooms older than this are no longer offered by quick match. */
const ROOM_FRESH_MS = 4 * 60_000;

export interface Member {
  name: string;
  carId: string;
  /** Last heartbeat (ms since epoch, the driver's clock). */
  at: number;
}

export interface Room {
  id: string;
  track: string;
  host: string;
  public: boolean;
  status: 'lobby' | 'racing';
  createdAt: number;
  /** Set (by the server clock) when the race is started. */
  startedAt: number | null;
  players: Record<string, Member>;
}

/** What a driver broadcasts while racing. */
export interface Live {
  x: number;
  y: number;
  /** Heading, radians. */
  h: number;
  /** Progress along the track in road samples (counts laps), used for the running order. */
  p: number;
  /** Finish time in ms, or null while still racing. */
  t: number | null;
  /** Gave up or disconnected. */
  d: boolean;
  /** Sender's clock when written. */
  at: number;
}

export type JoinError = 'missing' | 'full' | 'started';

interface Backend {
  uid(): Promise<string>;
  create(track: string, isPublic: boolean, me: Member): Promise<string>;
  join(id: string, me: Member): Promise<void>;
  leave(id: string): Promise<void>;
  beat(id: string): Promise<void>;
  start(id: string): Promise<void>;
  findOpen(track: string, exceptId?: string): Promise<Room | null>;
  watch(id: string, cb: (room: Room | null) => void): () => void;
  push(id: string, s: Live): Promise<void>;
  watchLive(id: string, cb: (uid: string, s: Live) => void): () => void;
}

export class PvpError extends Error {
  constructor(readonly code: JoinError) {
    super(code);
  }
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = (): string => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const cleanCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

/** Drivers whose lobby entry is recent enough to count. */
export function livePlayers(room: Room, now = Date.now()): Array<[string, Member]> {
  return Object.entries(room.players).filter(([, m]) => now - m.at < PRESENCE_MS).sort(([a], [b]) => (a < b ? -1 : 1));
}

const joinable = (r: Room, now: number) =>
  r.status === 'lobby' && r.public && now - r.createdAt < ROOM_FRESH_MS && Object.keys(r.players).length < ROOM_MAX && livePlayers(r, now).length > 0;

/** The oldest room worth joining (ties broken by code), so two lone hosts looking at each other pick the same one. */
const pickOpen = (rooms: Room[], exceptId?: string): Room | null => {
  const now = Date.now();
  const open = rooms.filter((r) => r.id !== exceptId && joinable(r, now));
  open.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  return open[0] ?? null;
};

// ---- Firestore ----

const firestore: Backend = {
  async uid() {
    return (await getFirebase()).uid;
  },

  async create(track, isPublic, me) {
    const { db, uid, fs } = await getFirebase();
    for (let tries = 0; ; tries++) {
      const id = newCode();
      try {
        await fs.setDoc(fs.doc(db, 'rooms', id), {
          track, host: uid, public: isPublic, status: 'lobby', createdAt: fs.serverTimestamp(), startedAt: null,
          players: { [uid]: me },
        });
        return id;
      } catch (e) {
        if (tries >= 4) throw e; // the code was taken (the write is refused as an update); try another
      }
    }
  },

  async join(id, me) {
    const { db, uid, fs } = await getFirebase();
    const ref = fs.doc(db, 'rooms', id);
    const snap = await fs.getDoc(ref);
    if (!snap.exists()) throw new PvpError('missing');
    const room = toRoom(id, snap.data({ serverTimestamps: 'estimate' }));
    if (room.status !== 'lobby') throw new PvpError('started');
    if (!room.players[uid] && Object.keys(room.players).length >= ROOM_MAX) throw new PvpError('full');
    try {
      await fs.updateDoc(ref, { [`players.${uid}`]: me });
    } catch {
      throw new PvpError('full'); // someone else took the last seat (the rules refuse a fifth)
    }
  },

  async leave(id) {
    const { db, uid, fs } = await getFirebase();
    await fs.updateDoc(fs.doc(db, 'rooms', id), { [`players.${uid}`]: fs.deleteField() });
  },

  async beat(id) {
    const { db, uid, fs } = await getFirebase();
    await fs.updateDoc(fs.doc(db, 'rooms', id), { [`players.${uid}.at`]: Date.now() });
  },

  async start(id) {
    const { db, fs } = await getFirebase();
    await fs.updateDoc(fs.doc(db, 'rooms', id), { status: 'racing', startedAt: fs.serverTimestamp() });
  },

  async findOpen(track, exceptId) {
    const { db, fs } = await getFirebase();
    const snap = await fs.getDocs(fs.query(fs.collection(db, 'rooms'),
      fs.where('track', '==', track), fs.where('status', '==', 'lobby'), fs.where('public', '==', true), fs.limit(12)));
    return pickOpen(snap.docs.map((d) => toRoom(d.id, d.data({ serverTimestamps: 'estimate' }))), exceptId);
  },

  watch(id, cb) {
    let stop = false;
    let off: (() => void) | null = null;
    void getFirebase().then(({ db, fs }) => {
      if (stop) return;
      off = fs.onSnapshot(fs.doc(db, 'rooms', id),
        (snap) => cb(snap.exists() ? toRoom(id, snap.data({ serverTimestamps: 'estimate' })) : null),
        () => cb(null));
    }).catch(() => cb(null));
    return () => { stop = true; off?.(); };
  },

  async push(id, s) {
    const { db, uid, fs } = await getFirebase();
    await fs.setDoc(fs.doc(db, 'rooms', id, 'live', uid), s);
  },

  watchLive(id, cb) {
    let stop = false;
    let off: (() => void) | null = null;
    void getFirebase().then(({ db, fs }) => {
      if (stop) return;
      off = fs.onSnapshot(fs.collection(db, 'rooms', id, 'live'), (snap) => {
        for (const ch of snap.docChanges()) if (ch.type !== 'removed') cb(ch.doc.id, ch.doc.data() as Live);
      });
    }).catch(() => undefined);
    return () => { stop = true; off?.(); };
  },
};

function toRoom(id: string, d: Record<string, unknown>): Room {
  const created = d.createdAt as { toMillis?: () => number } | null;
  const started = d.startedAt as { toMillis?: () => number } | null;
  return {
    id,
    track: String(d.track),
    host: String(d.host),
    public: d.public === true,
    status: d.status === 'racing' ? 'racing' : 'lobby',
    createdAt: created?.toMillis?.() ?? Date.now(),
    startedAt: started?.toMillis?.() ?? null,
    players: (d.players ?? {}) as Record<string, Member>,
  };
}

// ---- Dev: two tabs of one browser, through localStorage ----

const P = 'oversteer.pvp.';
const listeners = new Set<(key: string) => void>();
const notify = (key: string) => listeners.forEach((l) => l(key));
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => e.key && notify(e.key));

const lsGet = <T>(key: string): T | null => {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; } catch { return null; }
};
const lsSet = (key: string, v: unknown) => { localStorage.setItem(key, JSON.stringify(v)); notify(key); };

const localUid = (): string => {
  let u = sessionStorage.getItem(`${P}uid`);
  if (!u) sessionStorage.setItem(`${P}uid`, (u = `tab-${Math.random().toString(36).slice(2, 8)}`));
  return u;
};

const local: Backend = {
  async uid() {
    return localUid();
  },
  async create(track, isPublic, me) {
    const id = newCode();
    lsSet(`${P}room.${id}`, { id, track, host: localUid(), public: isPublic, status: 'lobby', createdAt: Date.now(), startedAt: null, players: { [localUid()]: me } } satisfies Room);
    return id;
  },
  async join(id, me) {
    const r = lsGet<Room>(`${P}room.${id}`);
    if (!r) throw new PvpError('missing');
    if (r.status !== 'lobby') throw new PvpError('started');
    if (!r.players[localUid()] && Object.keys(r.players).length >= ROOM_MAX) throw new PvpError('full');
    r.players[localUid()] = me;
    lsSet(`${P}room.${id}`, r);
  },
  async leave(id) {
    const r = lsGet<Room>(`${P}room.${id}`);
    if (!r) return;
    delete r.players[localUid()];
    lsSet(`${P}room.${id}`, r);
  },
  async beat(id) {
    const r = lsGet<Room>(`${P}room.${id}`);
    if (!r?.players[localUid()]) return;
    r.players[localUid()].at = Date.now();
    lsSet(`${P}room.${id}`, r);
  },
  async start(id) {
    const r = lsGet<Room>(`${P}room.${id}`);
    if (!r || r.status !== 'lobby') return;
    r.status = 'racing';
    r.startedAt = Date.now();
    lsSet(`${P}room.${id}`, r);
  },
  async findOpen(track, exceptId) {
    const rooms: Room[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const r = k?.startsWith(`${P}room.`) ? lsGet<Room>(k) : null;
      if (r && r.track === track) rooms.push(r);
    }
    return pickOpen(rooms, exceptId);
  },
  watch(id, cb) {
    const key = `${P}room.${id}`;
    const l = (k: string) => { if (k === key) cb(lsGet<Room>(key)); };
    listeners.add(l);
    queueMicrotask(() => l(key));
    return () => listeners.delete(l);
  },
  async push(id, s) {
    lsSet(`${P}live.${id}.${localUid()}`, s);
  },
  watchLive(id, cb) {
    const prefix = `${P}live.${id}.`;
    const l = (k: string) => {
      const s = k.startsWith(prefix) ? lsGet<Live>(k) : null;
      if (s) cb(k.slice(prefix.length), s);
    };
    listeners.add(l);
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) l(k); }
    return () => listeners.delete(l);
  },
};

const useLocal = (): boolean =>
  import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('pvp') === 'local';

/** Online play needs the Firebase project (or the dev-only local mode). */
export const pvpAvailable = (): boolean => useLocal() || firebaseConfigured;
export const pvp = (): Backend => (useLocal() ? local : firestore);
