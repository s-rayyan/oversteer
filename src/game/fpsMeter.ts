import Phaser from 'phaser';
import { quality, setLowQuality } from './quality';

// Not under the `oversteer.` prefix on purpose: that prefix is the player's save, and a display preference isn't progress.
// (A new key: the old one, `oversteerFps`, defaulted to showing the meter.)
const KEY = 'oversteerFpsShown';
/** Game pixels between the meter and the bottom of the picture: clear of the bottom-left hint line. */
const ABOVE_BOTTOM = 14;
const SLOW_FPS = 40; // below this...
const SLOW_TICKS = 6; // ...for this many readings in a row (3 s) turns low effects on
const FAST_FPS = 52; // at or above this, with low effects on...
const FAST_TICKS = 20; // ...for this many readings in a row (10 s) turns full effects back on
const FAST_TICKS_MAX = 240; // each time full effects bounce straight back to slow, wait twice as long (up to 2 min)
const BOUNCE_MS = 30_000; // slow again within this long of switching back up counts as a bounce
const SETTLED_MS = 60_000; // full effects held this long: forget past bounces
const TICK_MS = 500;
const HISTORY = 40; // readings in the little graph (20 s)
const GRAPH_W = 40;
const GRAPH_H = 14;
const GRAPH_MAX = 75; // fps at the top of the graph

const GOOD = '#52b788';
const OK = '#ffd166';
const BAD = '#e63946';
const colorFor = (fps: number) => (fps >= 50 ? GOOD : fps >= 30 ? OK : BAD);

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'; // hidden until the player presses P
  } catch {
    return false;
  }
}

function store(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/**
 * Small frames-per-second pill in the bottom-left corner of the picture, hidden until P shows it (P hides it again,
 * and the choice is remembered): a status dot, the frame rate, the frame time and a
 * 20-second graph. It is plain HTML rather than part of the game, so it costs the renderer nothing; it is updated
 * twice a second, writes to the page only when a number actually changes, and its fixed size and `contain` keep
 * those writes from making the browser re-lay out anything else. It lives inside the game's parent element so it
 * also shows in fullscreen, and it names the renderer: "Canvas" on a slow computer means the browser isn't giving
 * the game a graphics card. If the frame rate stays low for a few seconds the game switches to low effects by
 * itself, and back to full effects once it has run fast for a while (backing off if that makes it slow again).
 * Q flips it by hand, and a hand-picked setting is left alone.
 */
export function addFpsMeter(game: Phaser.Game): void {
  const parent = game.canvas.parentElement ?? document.body;
  parent.style.position ||= 'relative';

  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute', 'left:0', 'top:0', 'z-index:10', 'pointer-events:none',
    'display:none', 'align-items:center', 'gap:7px', 'height:24px', 'padding:0 9px 0 8px', 'box-sizing:border-box',
    'border-radius:999px', 'background:rgba(20,18,31,.62)', 'border:1px solid rgba(255,255,255,.09)',
    'box-shadow:0 2px 10px rgba(0,0,0,.28)', 'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
    'font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', 'color:#e9ecf5',
    'font-variant-numeric:tabular-nums', 'white-space:nowrap', 'contain:layout paint style', 'user-select:none',
  ].join(';');

  const dot = document.createElement('span');
  dot.style.cssText = 'width:7px;height:7px;border-radius:50%;flex:none;transition:background-color .3s,box-shadow .3s';
  const fpsText = document.createElement('span');
  fpsText.style.cssText = 'display:inline-block;min-width:44px';
  const msText = document.createElement('span');
  msText.style.cssText = 'display:inline-block;min-width:44px;color:#8d99ae;font-weight:500';
  const graph = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  graph.width = GRAPH_W * dpr;
  graph.height = GRAPH_H * dpr;
  graph.style.cssText = `width:${GRAPH_W}px;height:${GRAPH_H}px;flex:none`;
  const extra = document.createElement('span');
  extra.style.cssText = 'color:#8d99ae;font-weight:500';
  el.append(dot, fpsText, msText, graph, extra);
  parent.appendChild(el);

  // Pinned to the game picture's bottom-left corner (not the window's: the picture is letterboxed), so it follows
  // the picture as the window is resized or goes fullscreen.
  const place = () => {
    if (!on) return;
    const c = game.canvas.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    const scale = c.height / game.scale.height;
    el.style.transform = `translate(${Math.round(c.left - p.left + 6)}px, ${Math.round(c.bottom - p.top - ABOVE_BOTTOM * scale - el.offsetHeight)}px)`;
  };
  game.scale.on(Phaser.Scale.Events.RESIZE, place);
  window.addEventListener('resize', place);

  const ctx = graph.getContext('2d');
  ctx?.scale(dpr, dpr);
  const renderer = game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas';
  const history: number[] = [];
  let on = load();
  let slow = 0;
  let fast = 0;
  let fastNeeded = FAST_TICKS;
  let autoLow = false; // low effects were switched on by the game, so it may switch them off again (Q makes it manual)
  let raisedAt = 0;
  let shown = { fps: -1, low: !quality.low, on: false }; // starts hidden; the first refresh shows it if it's on

  const drawGraph = () => {
    if (!ctx) return;
    ctx.clearRect(0, 0, GRAPH_W, GRAPH_H);
    const step = GRAPH_W / (HISTORY - 1);
    const y = (fps: number) => GRAPH_H - 1 - (Math.min(fps, GRAPH_MAX) / GRAPH_MAX) * (GRAPH_H - 2);
    const x0 = GRAPH_W - (history.length - 1) * step;
    ctx.beginPath();
    history.forEach((f, i) => (i ? ctx.lineTo(x0 + i * step, y(f)) : ctx.moveTo(x0, y(f))));
    ctx.lineWidth = 1.25;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colorFor(history[history.length - 1] ?? 60);
    ctx.stroke();
  };

  const refresh = () => {
    const fps = Math.round(game.loop.actualFps);
    // Only judge a running game (a hidden tab stops drawing, and scene changes hiccup for a moment).
    const running = !document.hidden && game.scene.getScenes(true).some((s) => 'car' in s);
    if (running && fps < SLOW_FPS) slow++;
    else slow = 0;
    if (slow >= SLOW_TICKS && !quality.low) {
      if (raisedAt && performance.now() - raisedAt < BOUNCE_MS) fastNeeded = Math.min(fastNeeded * 2, FAST_TICKS_MAX);
      setLowQuality(true);
      autoLow = true;
      fast = 0;
    } else if (quality.low && autoLow) {
      // A fast computer again (plugged in, other tabs closed): go back to full effects.
      fast = running && fps >= FAST_FPS ? fast + 1 : 0;
      if (fast >= fastNeeded) {
        setLowQuality(false);
        autoLow = false;
        raisedAt = performance.now();
        fast = 0;
        slow = 0;
      }
    } else if (!quality.low && raisedAt && performance.now() - raisedAt > SETTLED_MS) {
      fastNeeded = FAST_TICKS;
    }

    if (document.hidden) return;
    history.push(fps);
    if (history.length > HISTORY) history.shift();

    if (on !== shown.on) {
      el.style.display = on ? 'flex' : 'none';
      place();
    }
    if (!on) {
      shown = { ...shown, on };
      return;
    }
    if (fps !== shown.fps) {
      const c = colorFor(fps);
      dot.style.backgroundColor = c;
      dot.style.boxShadow = `0 0 6px ${c}`;
      fpsText.textContent = `${fps} fps`;
      msText.textContent = fps > 0 ? `${(1000 / fps).toFixed(1)}ms` : '-';
    }
    if (quality.low !== shown.low || on !== shown.on) extra.textContent = `${renderer}${quality.low ? ' · low fx' : ''}`;
    drawGraph();
    shown = { fps, low: quality.low, on };
  };
  refresh();
  setInterval(refresh, TICK_MS);

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || (t && /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
    const k = e.key.toLowerCase();
    if (k === 'p') {
      on = !on;
      store(on);
      refresh();
    } else if (k === 'q') {
      setLowQuality(!quality.low);
      autoLow = false; // a hand-picked setting stays until Q is pressed again
      slow = 0;
      fast = 0;
      refresh();
    }
  });
}
