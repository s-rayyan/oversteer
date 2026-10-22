import type Phaser from 'phaser';
import { SIGNED_IN_EVENT, cachedAccount } from '../net/account';
import { pvp, pvpAvailable, type Beacon } from '../net/pvp';
import { signInRequired } from './accountDialog';
import { SceneKey } from './config';
import { TRACKS } from './tracks';

/**
 * Tells a player when someone opens a public PvP lobby. One Firestore document (lobbyBeacon/latest) is watched, so
 * the cost is one read per lobby opened, not a poll. Menus get a clickable toast; mid-race it is a small, silent
 * note in the corner with nothing to press, so a race is never interrupted.
 */

const KEY = 'oversteer.lobbyAlerts';
const FRESH_MS = 90_000; // ignore a beacon older than this (it was already there when we connected)
const COOLDOWN_MS = 60_000;
const MENU_MS = 8000;
const RACE_MS = 4000;
const RACING = new Set<string>([SceneKey.Race, SceneKey.Endless, SceneKey.Oversteer, SceneKey.Tutorial, SceneKey.Pvp]);

export const lobbyAlertsOn = (): boolean => {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
};

let game: Phaser.Game | null = null;
let stopWatch: (() => void) | null = null;
let myUid = '';
let lastShown = 0;
const seen = new Set<string>();
let toast: HTMLDivElement | null = null;
let toastTimer = 0;

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

function refresh(): void {
  const want = lobbyAlertsOn() && pvpAvailable() && (!signInRequired() || !!cachedAccount());
  if (!want) {
    stopWatch?.();
    stopWatch = null;
    hide();
    return;
  }
  if (stopWatch) return;
  void pvp().uid().then((u) => { myUid = u; }).catch(() => undefined);
  stopWatch = pvp().watchBeacon(onBeacon);
}

function onBeacon(b: Beacon): void {
  const now = Date.now();
  if (!game || b.host === myUid || seen.has(b.room)) return;
  seen.add(b.room);
  if (now - b.at > FRESH_MS || now - lastShown < COOLDOWN_MS) return;
  const active = game.scene.getScenes(true).map((s) => s.scene.key);
  if (!active.length || active.includes(SceneKey.Boot) || active.includes(SceneKey.PvpLobby)) return; // already looking for a race
  lastShown = now;
  const track = TRACKS.find((t) => t.id === b.track);
  const label = `${b.name.toUpperCase()} WANTS A PVP RACE${track ? ` ON ${track.name.toUpperCase()}` : ''}`;
  if (active.some((k) => RACING.has(k))) show(label, null, RACE_MS);
  else show(label, () => join(b), MENU_MS);
}

function join(b: Beacon): void {
  hide();
  const current = game?.scene.getScenes(true)[0];
  current?.scene.start(SceneKey.PvpLobby, { trackId: b.track, joinCode: b.room });
}

function hide(): void {
  clearTimeout(toastTimer);
  toast?.remove();
  toast = null;
}

function show(text: string, onJoin: (() => void) | null, ms: number): void {
  hide();
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = `position:fixed;top:10px;right:10px;z-index:50;max-width:260px;background:#14121f;border:2px solid #ffd166;color:#fff;font:${onJoin ? 12 : 10}px monospace;padding:${onJoin ? '8px 10px' : '5px 8px'};box-shadow:0 2px 8px #0008;pointer-events:${onJoin ? 'auto' : 'none'};opacity:${onJoin ? 1 : 0.85}`;
  const line = document.createElement('div');
  line.textContent = text;
  el.append(line);
  if (onJoin) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-top:6px';
    const btn = (label: string, bg: string, fn: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = `background:${bg};border:0;color:#14121f;font:bold 11px monospace;padding:5px 10px;cursor:pointer`;
      b.addEventListener('click', fn);
      return b;
    };
    row.append(btn('JOIN', '#ffd166', onJoin), btn('NO THANKS', '#c9d1e3', hide));
    el.append(row);
  } else {
    const note = document.createElement('div');
    note.style.cssText = 'color:#8d99ae;margin-top:2px';
    note.textContent = 'Find them in ONLINE RACE after this one';
    el.append(note);
  }
  document.body.append(el);
  toast = el;
  toastTimer = window.setTimeout(hide, ms);
}
