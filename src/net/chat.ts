import { getName } from '../game/player';
import { getRealtime, realtimeConfigured } from './firebase';
import { pvp, pvpAvailable, pvpIsLocal } from './pvp';

/**
 * Chat inside a PvP room. Messages live in the Realtime Database (`chat/{room}/{pushId}`), which bills bandwidth
 * rather than per-document reads. A client loads the last SHOW messages of its own room and then hears new ones; the
 * host deletes the room's chat when the race starts or the room closes. With `?pvp=local` on a dev build the same
 * interface runs over localStorage for two tabs of one browser.
 */

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  at: number;
}

export const CHAT_MAX = 80;
const SHOW = 30;
const GAP_MS = 1500;
const LOCAL_KEY = (room: string) => `oversteer.chat.${room}`;

export const chatAvailable = (): boolean => pvpAvailable() && (pvpIsLocal() || realtimeConfigured);

const clean = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);

let lastSent = 0;

/** Posts a message to the room. Rejects with 'cooldown' if sent too soon after the last one, 'empty' if there is nothing to send. */
export async function sendChat(room: string, raw: string): Promise<void> {
  const text = clean(raw);
  if (!text) throw new Error('empty');
  if (Date.now() - lastSent < GAP_MS) throw new Error('cooldown');
  const name = getName();
  if (!name) throw new Error('noname');
  lastSent = Date.now();
  const uid = await pvp().uid();
  if (pvpIsLocal()) {
    const all = readLocal(room);
    all.push({ id: `${Date.now()}${Math.random()}`, uid, name, text, at: Date.now() });
    localStorage.setItem(LOCAL_KEY(room), JSON.stringify(all.slice(-SHOW)));
    return;
  }
  const { rtdb, rt } = await getRealtime();
  await rt.push(rt.ref(rtdb, `chat/${room}`), { u: uid, n: name, t: text, at: rt.serverTimestamp() });
}

/** Throws the room's messages away (the host does this when the room is over). */
export async function clearChat(room: string): Promise<void> {
  if (pvpIsLocal()) { localStorage.removeItem(LOCAL_KEY(room)); return; }
  if (!realtimeConfigured) return;
  const { rtdb, rt } = await getRealtime();
  await rt.remove(rt.ref(rtdb, `chat/${room}`));
}

function readLocal(room: string): ChatMessage[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY(room)) ?? '[]') as ChatMessage[]; } catch { return []; }
}

/** Calls `cb` for each of the room's last messages, then for every new one, oldest first. Returns a function that stops it. */
export function watchChat(room: string, cb: (m: ChatMessage) => void): () => void {
  let stop = false;
  let off: (() => void) | null = null;
  let timer = 0;
  if (pvpIsLocal()) {
    const seen = new Set<string>();
    const read = () => { for (const m of readLocal(room)) if (!seen.has(m.id)) { seen.add(m.id); cb(m); } };
    timer = window.setInterval(read, 1000);
    read();
    return () => clearInterval(timer);
  }
  if (!realtimeConfigured) return () => undefined;
  void getRealtime().then(({ rtdb, rt }) => {
    if (stop) return;
    off = rt.onChildAdded(rt.query(rt.ref(rtdb, `chat/${room}`), rt.limitToLast(SHOW)), (snap) => {
      const v = snap.val() as { u?: string; n?: string; t?: string; at?: number } | null;
      if (!snap.key || !v || typeof v.t !== 'string') return;
      cb({ id: snap.key, uid: String(v.u ?? ''), name: String(v.n ?? '???'), text: v.t, at: typeof v.at === 'number' ? v.at : Date.now() });
    }, () => undefined);
  }).catch(() => undefined);
  return () => { stop = true; off?.(); };
}
