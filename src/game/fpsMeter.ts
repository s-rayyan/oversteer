import Phaser from 'phaser';
import { quality, setLowQuality } from './quality';

// Not under the `oversteer.` prefix on purpose: that prefix is the player's save, and a display preference isn't progress.
const KEY = 'oversteerFps';
const SLOW_FPS = 40; // below this...
const SLOW_TICKS = 6; // ...for this many readings in a row (3 s) turns low effects on

function load(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'; // on unless the player turned it off
  } catch {
    return true;
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
 * Small frames-per-second readout in the corner (P toggles it). It is plain HTML rather than part of the game, so
 * it costs the renderer nothing, and it lives inside the game's parent element so it also shows in fullscreen.
 * Also names the renderer: "Canvas" on a slow computer means the browser isn't giving the game a graphics card.
 * If the frame rate stays low for a few seconds the game switches to low effects by itself (Q flips it back).
 */
export function addFpsMeter(game: Phaser.Game): void {
  const parent = game.canvas.parentElement ?? document.body;
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;top:50%;left:4px;padding:2px 5px;background:rgba(20,18,31,.8);font:11px monospace;color:#52b788;pointer-events:none;z-index:10;white-space:pre';
  parent.style.position ||= 'relative';
  parent.appendChild(el);

  const renderer = game.renderer.type === Phaser.WEBGL ? 'WebGL' : 'Canvas';
  let on = load();
  let slow = 0;
  const refresh = () => {
    const fps = Math.round(game.loop.actualFps);
    // Only judge a running game (a hidden tab stops drawing, and scene changes hiccup for a moment).
    if (!document.hidden && fps < SLOW_FPS && game.scene.getScenes(true).some((s) => s.sys.settings.key.endsWith('Scene') && 'car' in s)) slow++;
    else slow = 0;
    if (slow >= SLOW_TICKS && !quality.low) setLowQuality(true);
    el.style.display = on ? 'block' : 'none';
    if (!on) return;
    el.style.color = fps >= 50 ? '#52b788' : fps >= 30 ? '#ffd166' : '#e63946';
    el.textContent = `${fps} FPS  ${renderer}${quality.low ? '  low fx (Q)' : ''}`;
  };
  refresh();
  setInterval(refresh, 500);

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
      slow = 0;
      refresh();
    }
  });
}
