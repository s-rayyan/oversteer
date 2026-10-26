import type Phaser from 'phaser';
import { SIGNED_IN_EVENT, cachedAccount } from '../net/account';
import { pvp, pvpAvailable, type Beacon } from '../net/pvp';
import { clearChallenge, socialAvailable, startPresence, watchChallenges, type Challenge, type Status } from '../net/social';
import { signInRequired } from './accountDialog';
import { audio } from './audio';
import { SceneKey } from './config';
import { TRACKS } from './tracks';

/**
 * Tells a player when someone opens a public PvP lobby or challenges them. One Firestore document
 * (lobbyBeacon/latest) is watched for lobbies, so the cost is one read per lobby opened, not a poll; challenges
 * arrive through the Realtime Database. The note is a big banner at the top of the screen with a JOIN button, in
 * menus and mid-race alike. Joining mid-race leaves that race, so it is always the player's choice: click JOIN or
 * press J; otherwise the note goes away by itself and the race carries on untouched.
 */

const KEY = 'oversteer.lobbyAlerts';
const FRESH_MS = 90_000; // ignore a beacon older than this (it was already there when we connected)
const COOLDOWN_MS = 60_000;
const MENU_MS = 14_000;
const RACE_MS = 9_000;
const CHALLENGE_MS = 30_000;
const RACING = new Set<string>([SceneKey.Race, SceneKey.Endless, SceneKey.Oversteer, SceneKey.Tutorial, SceneKey.Pvp]);

export const lobbyAlertsOn = (): boolean => {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
};

let game: Phaser.Game | null = null;
let stopWatch: (() => void) | null = null;
let stopChallenges: (() => void) | null = null;
let myUid = '';
let lastShown = 0;
const seen = new Set<string>();
let toast: HTMLDivElement | null = null;
let toastTimer = 0;
let toastKey: ((e: KeyboardEvent) => void) | null = null;

/** Starts watching (once signed in, if sign-in is required). Safe to call again; it never double-subscribes. */
export function initLobbyAlerts(g: Phaser.Game): void {
  game = g;
  window.addEventListener(SIGNED_IN_EVENT, () => refresh());
  refresh();
}

export function setLobbyAlerts(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
  refresh();
}

const signedInEnough = (): boolean => pvpAvailable() && (!signInRequired() || !!cachedAccount());

/** What the player is doing, shown next to their name on the WHO IS ONLINE page. */
function status(): Status {
  const active = game?.scene.getScenes(true).map((s) => s.scene.key) ?? [];
  if (active.some((k) => RACING.has(k))) return 'racing';
  if (active.includes(SceneKey.PvpLobby)) return 'lobby';
  return 'menu';
}

function refresh(): void {
  if (!signedInEnough()) {
    stopWatch?.();
    stopWatch = null;
    stopChallenges?.();
    stopChallenges = null;
    hide();
    return;
  }
  void pvp().uid().then((u) => { myUid = u; }).catch(() => undefined);
  // Challenges and presence are always on: they are things a player asked for by going to those pages, or that
  // someone asked of them. The lobby-alert switch only controls the public-lobby note.
  if (socialAvailable()) {
    startPresence(status);
    stopChallenges ??= watchChallenges(onChallenge);
  }
  if (lobbyAlertsOn()) stopWatch ??= pvp().watchBeacon(onBeacon);
  else { stopWatch?.(); stopWatch = null; }
}

function activeKeys(): string[] {
  return game?.scene.getScenes(true).map((s) => s.scene.key) ?? [];
}

function onBeacon(b: Beacon): void {
  const now = Date.now();
  if (!game || b.host === myUid || seen.has(b.room)) return;
  seen.add(b.room);
  if (now - b.at > FRESH_MS || now - lastShown < COOLDOWN_MS) return;
  const active = activeKeys();
  if (!active.length || active.includes(SceneKey.Boot) || active.includes(SceneKey.PvpLobby)) return; // already looking for a race
  lastShown = now;
  const track = TRACKS.find((t) => t.id === b.track);
  show({
    title: `${b.name.toUpperCase()} WANTS A PVP RACE`,
    body: track ? `on ${track.name.toUpperCase()}` : '',
    join: () => goToRoom(b.room, b.track),
    ms: active.some((k) => RACING.has(k)) ? RACE_MS : MENU_MS,
    racing: active.some((k) => RACING.has(k)),
  });
}

function onChallenge(c: Challenge): void {
  if (!game || c.from === myUid) return;
  const active = activeKeys();
  if (!active.length || active.includes(SceneKey.Boot)) {
    // Still loading: try again in a moment so a challenge that was waiting for us is not lost.
    window.setTimeout(() => onChallenge(c), 1500);
    return;
  }
  const track = TRACKS.find((t) => t.id === c.track);
  const racing = active.some((k) => RACING.has(k));
  show({
    title: `${c.name.toUpperCase()} CHALLENGED YOU!`,
    body: track ? `1v1 on ${track.name.toUpperCase()}` : '1v1 race',
    join: () => { void clearChallenge(c.from).catch(() => undefined); goToRoom(c.room, c.track); },
    joinLabel: 'ACCEPT',
    decline: () => void clearChallenge(c.from).catch(() => undefined),
    ms: CHALLENGE_MS,
    racing,
  });
}

function goToRoom(room: string, trackId: string): void {
  hide();
  const current = game?.scene.getScenes(true)[0];
  current?.scene.start(SceneKey.PvpLobby, { trackId, joinCode: room });
}

function hide(): void {
  clearTimeout(toastTimer);
  toast?.remove();
  toast = null;
  if (toastKey) window.removeEventListener('keydown', toastKey);
  toastKey = null;
}

interface ToastOpts {
  title: string;
  body: string;
  join: () => void;
  joinLabel?: string;
  /** Pressing this (or letting the note time out) turns the offer down. */
  decline?: () => void;
  ms: number;
  /** Joining will leave a race in progress: say so. */
  racing: boolean;
}

const STYLE_ID = 'oversteer-toast-style';
function addStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes ov-toast-in { from { transform: translate(-50%, -140%); opacity: 0 } to { transform: translate(-50%, 0); opacity: 1 } }
    @keyframes ov-toast-glow { 0%, 100% { box-shadow: 0 0 0 0 #ffd16680, 0 6px 22px #000c } 50% { box-shadow: 0 0 0 7px #ffd16600, 0 6px 22px #000c } }
    @keyframes ov-toast-time { from { width: 100% } to { width: 0 } }
    @media (prefers-reduced-motion: reduce) { .ov-toast { animation: none !important } }`;
  document.head.append(s);
}

function show(o: ToastOpts): void {
  hide();
  addStyle();
  audio.sfx('goal');
  const el = document.createElement('div');
  el.className = 'ov-toast';
  el.setAttribute('role', 'alert');
  el.style.cssText = `position:fixed;top:12px;left:50%;transform:translate(-50%,0);z-index:50;width:min(420px,calc(100vw - 24px));box-sizing:border-box;background:#1d1b2e;border:3px solid #ffd166;color:#fff;font-family:monospace;padding:12px 14px 14px;text-align:center;animation:ov-toast-in .28s ease-out,ov-toast-glow 1.4s ease-in-out .3s 4;overflow:hidden`;
  const title = document.createElement('div');
  title.textContent = o.title;
  title.style.cssText = 'color:#ffd166;font-weight:bold;font-size:17px;line-height:1.25';
  el.append(title);
  if (o.body) {
    const body = document.createElement('div');
    body.textContent = o.body;
    body.style.cssText = 'color:#fff;font-size:14px;margin-top:3px';
    el.append(body);
  }
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-top:10px;justify-content:center';
  const btn = (label: string, bg: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `background:${bg};border:0;color:#14121f;font:bold 14px monospace;padding:9px 18px;cursor:pointer;flex:1;max-width:170px`;
    b.addEventListener('click', fn);
    return b;
  };
  const decline = () => { o.decline?.(); hide(); };
  row.append(btn(`${o.joinLabel ?? 'JOIN'} (J)`, '#ffd166', () => o.join()), btn(o.decline ? 'DECLINE' : 'NO THANKS', '#c9d1e3', decline));
  el.append(row);
  if (o.racing) {
    const warn = document.createElement('div');
    warn.textContent = 'Joining leaves your current race';
    warn.style.cssText = 'color:#8d99ae;font-size:11px;margin-top:7px';
    el.append(warn);
  }
  const bar = document.createElement('div');
  bar.style.cssText = `position:absolute;left:0;bottom:0;height:4px;background:#ffd166;animation:ov-toast-time ${o.ms}ms linear forwards`;
  el.append(bar);
  document.body.append(el);
  toast = el;
  toastTimer = window.setTimeout(() => { o.decline?.(); hide(); }, o.ms);
  // J joins without reaching for the mouse (it isn't a driving key). Typing in a text box is left alone.
  toastKey = (e) => {
    const t = e.target as HTMLElement | null;
    if ((e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey && !e.altKey && !(t && /^(INPUT|TEXTAREA)$/.test(t.tagName))) {
      e.preventDefault();
      o.join();
    }
  };
  window.addEventListener('keydown', toastKey);
}
