// Moving players off the embedded (iframe) copy of the game.
//
// Browsers partition storage by the top-level site, so the game inside the game hub's iframe has its own
// localStorage, separate from the game opened directly. When the game finds itself embedded it packs its
// save into a link's #fragment (which never leaves the browser) and immediately sends the whole page to
// the standalone game, which merges the save in before starting (see saveMerge.ts). If the browser
// blocks that automatic redirect, one click on PLAY does it; if even that is blocked, a new tab or a
// copyable link carries the save instead.
import { HOME_HOST } from './config';
import { DEVICE_ONLY_KEYS, IMPORTED_KEY, LB_SYNCED_KEY, MIGRATED_KEY, SAVE_PREFIX, TRANSFER_ID_KEY, hasProgress, mergeSaves, type SaveData } from './saveMerge';

/** True when the game is running inside an iframe (e.g. the game hub). */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent
  }
}

/**
 * True on an old address of the game: a Firebase Hosting site that isn't the home one. Local development
 * and any other host are left alone.
 */
export function onOldAddress(): boolean {
  const h = location.hostname;
  return h !== HOME_HOST && (h.endsWith('.web.app') || h.endsWith('.firebaseapp.com'));
}

/** Where the standalone game lives: the home address when deployed, otherwise wherever we are (dev). */
function homeOrigin(): string {
  const h = location.hostname;
  return h.endsWith('.web.app') || h.endsWith('.firebaseapp.com') ? `https://${HOME_HOST}` : location.origin;
}

function readSave(): SaveData {
  const out: SaveData = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SAVE_PREFIX)) out[k] = localStorage.getItem(k) ?? '';
    }
  } catch {
    /* storage unavailable */
  }
  return out;
}

function writeSave(save: SaveData): void {
  for (const [k, v] of Object.entries(save)) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage full or unavailable */
    }
  }
}

/** The save as handed over: everything except our own bookkeeping. */
function exportable(): SaveData {
  const s = readSave();
  delete s[MIGRATED_KEY];
  delete s[IMPORTED_KEY];
  delete s[TRANSFER_ID_KEY];
  delete s[LB_SYNCED_KEY];
  for (const k of DEVICE_ONLY_KEYS) delete s[k];
  return s;
}

/** This save's transfer id: the same on every attempt, so moving it twice never counts its coins twice. */
function transferId(): string {
  try {
    let id = localStorage.getItem(TRANSFER_ID_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(TRANSFER_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unsaved-' + Math.random().toString(36).slice(2);
  }
}

// ---------- fragment encoding (fallback link) ----------

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encode(payload: unknown): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  return typeof CompressionStream === 'function' ? 'z' + toB64(await pipe(raw, new CompressionStream('gzip'))) : 'j' + toB64(raw);
}

export async function decode(s: string): Promise<{ id: string; data: SaveData }> {
  const bytes = fromB64(s.slice(1));
  const raw = s[0] === 'z' ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

// ---------- receiving side (the game opened in its own tab) ----------

function cleanUrl(): void {
  history.replaceState(null, '', location.pathname);
}

/** Call before the game starts: applies a save carried in a `#save=` link from the embedded copy. */
export async function receiveSave(): Promise<void> {
  if (!location.hash.startsWith('#save=')) return;
  try {
    const { id, data } = await decode(location.hash.slice('#save='.length));
    writeSave(mergeSaves(readSave(), data, id));
  } catch {
    /* bad link: ignore */
  }
  cleanUrl();
}

// ---------- sending side (the embedded copy) ----------

/** Longest link we build; ghosts are added (fastest first) only while the link stays under this. */
const MAX_LINK = 60_000;

/** Link to the standalone game carrying this save (all of it if it fits; otherwise without some ghosts). */
async function saveLink(): Promise<string> {
  const save = exportable();
  if (!hasProgress(save)) return homeOrigin() + '/';
  const id = transferId();
  const base: SaveData = Object.fromEntries(Object.entries(save).filter(([k]) => !k.startsWith('oversteer.ghost.')));
  const ghosts = Object.entries(save).filter(([k]) => k.startsWith('oversteer.ghost.'));
  let link = `${homeOrigin()}/#save=${await encode({ id, data: base })}`;
  for (const [k, v] of ghosts) {
    const next = `${homeOrigin()}/#save=${await encode({ id, data: { ...base, [k]: v } })}`;
    if (next.length > MAX_LINK) continue;
    base[k] = v;
    link = next;
  }
  return link;
}

/** Sends the whole browser tab to `url`. Returns false if the browser refused (no click yet, or a sandbox). */
function redirectTop(url: string): boolean {
  try {
    (window.top ?? window).location.href = url;
    return true;
  } catch {
    return false;
  }
}

const css = {
  wrap: 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#14121f;font-family:monospace;color:#fff;padding:16px;box-sizing:border-box',
  card: 'width:min(460px,100%);text-align:center',
  title: 'color:#ffd166;font-size:30px;letter-spacing:2px;margin-bottom:14px',
  text: 'color:#c9d1e3;font-size:14px;line-height:1.5;margin:0 0 16px',
  button: 'background:#ffd166;border:0;color:#14121f;font:bold 16px monospace;padding:12px 20px;cursor:pointer;width:100%',
  small: 'background:none;border:0;color:#8d99ae;font:12px monospace;margin-top:14px;cursor:pointer;text-decoration:underline',
  field: 'width:100%;box-sizing:border-box;background:#1d1b2e;border:2px solid #3d405b;color:#c9d1e3;font:11px monospace;padding:8px;margin:8px 0;resize:none',
};

/**
 * Called instead of starting the game when it is embedded: takes the player (and their save) to the
 * standalone game. `playHere` starts the game in the iframe anyway, offered only if nothing else works.
 */
export function showLauncher(playHere: () => void): void {
  const root = document.createElement('div');
  root.style.cssText = css.wrap;
  document.body.appendChild(root);
  const render = (html: string) => {
    root.innerHTML = `<div style="${css.card}"><div style="${css.title}">OVERSTEER</div>${html}</div>`;
  };
  render(`<p style="${css.text}">Opening Oversteer...</p>`);

  void saveLink().then((link) => {
    // Try straight away. Most browsers only allow an embedded page to move the whole tab after a click,
    // so if we're still here a moment later, ask for one.
    redirectTop(link);
    setTimeout(() => {
      render(`<p style="${css.text}">Oversteer now runs in its own page. Your save comes with you.</p><button data-play style="${css.button}">PLAY OVERSTEER</button>`);
      root.querySelector('[data-play]')!.addEventListener('click', () => {
        if (redirectTop(link)) return;
        if (window.open(link, '_blank')) {
          render(`<p style="${css.text}">Oversteer opened in a new tab. Play there from now on.</p>`);
          return;
        }
        showCopyLink(link);
      });
    }, 1500);
  });

  /** Nothing can leave the iframe: let the player carry the link over by hand. */
  function showCopyLink(link: string): void {
    render(`<p style="${css.text}">Your browser blocked opening Oversteer from here. Open this link in a new tab; it carries your save:</p>
      <textarea readonly rows="4" style="${css.field}">${link}</textarea>
      <button data-copy style="${css.button}">COPY LINK</button>
      <button data-here style="${css.small}">play here instead (progress here won't carry over)</button>`);
    const field = root.querySelector('textarea')!;
    field.addEventListener('focus', () => field.select());
    root.querySelector('[data-copy]')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(link);
        btn.textContent = 'COPIED! PASTE IT INTO A NEW TAB';
      } catch {
        field.focus();
        btn.textContent = 'SELECTED: PRESS CTRL/CMD+C';
      }
    });
    root.querySelector('[data-here]')!.addEventListener('click', () => {
      root.remove();
      playHere();
    });
  }
}

// ---------- moving players from an old address to the home address, silently ----------

/**
 * Called instead of starting the game on an old address. Shows nothing: the page is just the game's own dark
 * background while it packs the save into the link's #fragment (which never leaves the browser) and sends the
 * tab to the home address, where receiveSave() merges it in before the game starts. If anything goes wrong, or
 * the move doesn't happen, the game simply starts here with the save it has, so nobody is stranded.
 */
export async function moveToHome(playHere: () => void): Promise<void> {
  try {
    location.replace(await saveLink());
  } catch {
    playHere();
    return;
  }
  setTimeout(playHere, 8000); // still here: the move didn't happen, so just play on this address
}
