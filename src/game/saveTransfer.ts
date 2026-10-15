// Moving players off the embedded (iframe) copy of the game.
//
// Browsers partition storage by the top-level site, so the game inside the game hub's iframe has its own
// localStorage, separate from the game opened directly. Both copies are the same origin, though, so the
// embedded copy can open the game in a new tab and hand its save over with postMessage. Nothing goes
// through a server. The new tab merges it with whatever it already has (see saveMerge.ts).
//
// If the browser blocks the new tab from talking back, the launcher falls back to a link carrying the save
// (without ghosts, to keep it short) in the URL #fragment, which never leaves the browser.
import { IMPORTED_KEY, MIGRATED_KEY, SAVE_PREFIX, TRANSFER_ID_KEY, describeSave, hasProgress, mergeSaves, type SaveData } from './saveMerge';

const MSG_READY = 'oversteer-ready';
const MSG_SAVE = 'oversteer-save';
const MSG_DONE = 'oversteer-imported';

/** True when the game is running inside an iframe (e.g. the game hub). */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent
  }
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

async function encode(payload: unknown): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  return typeof CompressionStream === 'function' ? 'z' + toB64(await pipe(raw, new CompressionStream('gzip'))) : 'j' + toB64(raw);
}

async function decode(s: string): Promise<{ id: string; data: SaveData }> {
  const bytes = fromB64(s.slice(1));
  const raw = s[0] === 'z' ? await pipe(bytes, new DecompressionStream('gzip')) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

// ---------- receiving side (the game opened in its own tab) ----------

function cleanUrl(): void {
  history.replaceState(null, '', location.pathname);
}

/**
 * Call before the game starts. Applies a save handed over by the embedded copy, either through
 * postMessage (`?import=1`, opened by the launcher) or the fallback `#save=` link.
 */
export async function receiveSave(): Promise<void> {
  if (location.hash.startsWith('#save=')) {
    try {
      const { id, data } = await decode(location.hash.slice('#save='.length));
      writeSave(mergeSaves(readSave(), data, id));
    } catch {
      /* bad link: ignore */
    }
    cleanUrl();
  }

  if (!new URLSearchParams(location.search).has('import')) return;
  const opener = window.opener as Window | null;
  if (!opener) {
    cleanUrl();
    return;
  }
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      cleanUrl();
      resolve();
    };
    const timer = setTimeout(finish, 8000);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== opener || e.data?.type !== MSG_SAVE) return;
      writeSave(mergeSaves(readSave(), e.data.data as SaveData, String(e.data.id)));
      opener.postMessage({ type: MSG_DONE, id: e.data.id }, location.origin);
      finish();
    };
    window.addEventListener('message', onMessage);
    try {
      opener.postMessage({ type: MSG_READY }, location.origin);
    } catch {
      finish();
    }
  });
}

// ---------- sending side (the embedded copy) ----------

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
 * Shown instead of the game when it is embedded. Moves the save into the standalone copy and opens it.
 * `playHere` starts the game in the iframe anyway.
 */
export function showLauncher(playHere: () => void): void {
  const root = document.createElement('div');
  root.style.cssText = css.wrap;
  document.body.appendChild(root);

  const render = (html: string) => {
    root.innerHTML = `<div style="${css.card}"><div style="${css.title}">OVERSTEER</div>${html}
      <button data-here style="${css.small}">play here instead (progress here won't carry over)</button></div>`;
    root.querySelector('[data-here]')!.addEventListener('click', () => {
      root.remove();
      playHere();
    });
  };

  const save = exportable();
  const movedAt = (() => {
    try {
      return Number(localStorage.getItem(MIGRATED_KEY)) || 0;
    } catch {
      return 0;
    }
  })();

  const showOpen = (message: string) => {
    render(`<p style="${css.text}">${message}</p><button data-open style="${css.button}">OPEN OVERSTEER</button>`);
    root.querySelector('[data-open]')!.addEventListener('click', () => window.open(location.origin + '/', '_blank'));
  };

  if (!hasProgress(save)) {
    showOpen('Oversteer now runs in its own tab.');
    return;
  }
  if (movedAt) {
    // Already synced: no screen, just send the player to the standalone game.
    try {
      (window.top ?? window).location.href = location.origin + '/';
    } catch {
      // Top navigation blocked (sandboxed or cross-origin parent): fall back to the open button.
      showOpen('Oversteer now runs in its own tab.');
    }
    return;
  }

  render(`<p style="${css.text}">Oversteer now runs in its own tab. Your save is stored here:<br><b style="color:#fff">${describeSave(save) || 'your progress'}</b>.<br>Move it over so you don't lose anything.</p>
    <button data-move style="${css.button}">MOVE MY SAVE &amp; PLAY</button>`);
  root.querySelector('[data-move]')!.addEventListener('click', () => {
    const id = transferId();
    const tab = window.open(location.origin + '/?import=1', '_blank');
    let answered = false;

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || !tab || e.source !== tab) return;
      if (e.data?.type === MSG_READY) {
        answered = true;
        tab.postMessage({ type: MSG_SAVE, id, data: save }, location.origin);
      } else if (e.data?.type === MSG_DONE && e.data.id === id) {
        window.removeEventListener('message', onMessage);
        try {
          localStorage.setItem(MIGRATED_KEY, String(Date.now()));
        } catch {
          /* storage unavailable */
        }
        showOpen('Done! Your save is in the new tab. Play there from now on.');
      }
    };
    window.addEventListener('message', onMessage);
    render(`<p style="${css.text}">Moving your save to the new tab...</p>`);
    setTimeout(() => {
      if (!answered) void showFallback(id, save);
    }, tab ? 8000 : 0);
  });

  /** The new tab was blocked or never answered: give the player a link that carries the save instead. */
  async function showFallback(id: string, data: SaveData): Promise<void> {
    const small: SaveData = Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith('oversteer.ghost.')));
    const url = `${location.origin}/#save=${await encode({ id, data: small })}`;
    render(`<p style="${css.text}">Your browser didn't let the new tab open. Open this link in a new tab to move your save (coins, cars, records):</p>
      <textarea readonly rows="4" style="${css.field}">${url}</textarea>
      <button data-copy style="${css.button}">COPY LINK</button>`);
    const field = root.querySelector('textarea')!;
    field.addEventListener('focus', () => field.select());
    root.querySelector('[data-copy]')!.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = 'COPIED! PASTE IT INTO A NEW TAB';
      } catch {
        field.focus();
        btn.textContent = 'SELECTED: PRESS CTRL/CMD+C';
      }
    });
  }
}
