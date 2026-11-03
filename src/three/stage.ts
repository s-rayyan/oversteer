import * as THREE from 'three';
import type Phaser from 'phaser';
import { quality } from '../game/quality';

/**
 * The 3D game draws with three.js into its own canvas, placed exactly under Phaser's canvas (which is transparent,
 * see main.ts), so the HUD, menus and overlays are still Phaser's and sit on top of the 3D picture. One renderer
 * and one canvas are made the first time a 3D race starts and kept for the rest of the visit: browsers allow only
 * a handful of WebGL contexts, so restarting a race must never make a new one.
 */
export class Stage3D {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private last = '';

  constructor(private readonly game: Phaser.Game) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;z-index:0;display:none;image-rendering:auto;pointer-events:none';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Always on: low effects turns the sun's shadow off instead (see World3D), which three.js handles without
    // recompiling anything by hand.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  show(on: boolean): void {
    this.canvas.style.display = on ? 'block' : 'none';
    if (on) this.place();
  }

  /**
   * Keeps the 3D canvas on top of the game picture: same parent (Phaser moves its canvas into a wrapper when it
   * goes fullscreen), same place and size. Cheap when nothing changed, so it runs every frame.
   */
  place(): void {
    const gc = this.game.canvas;
    const parent = gc.parentElement;
    if (!parent) return;
    if (this.canvas.parentElement !== parent) {
      if (!parent.style.position) parent.style.position = 'relative';
      parent.insertBefore(this.canvas, gc);
    }
    if (gc.style.position !== 'relative') {
      gc.style.position = 'relative';
      gc.style.zIndex = '1';
    }
    const w = gc.offsetWidth;
    const h = gc.offsetHeight;
    const low = quality.low;
    const key = `${gc.offsetLeft},${gc.offsetTop},${w},${h},${low},${window.devicePixelRatio}`;
    if (key === this.last) return;
    this.last = key;
    this.canvas.style.left = `${gc.offsetLeft}px`;
    this.canvas.style.top = `${gc.offsetTop}px`;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Full effects: up to 1.5x the screen's pixels (capped so a 4K screen doesn't melt a laptop). Low effects: half
    // the pixels, scaled up chunky to match the pixel art.
    const dpr = window.devicePixelRatio || 1;
    let ratio = low ? 0.5 : Math.min(dpr, 1.5);
    const maxPixels = 2560 * 1440;
    if (w * h * ratio * ratio > maxPixels) ratio = Math.sqrt(maxPixels / (w * h));
    this.canvas.style.imageRendering = low ? 'pixelated' : 'auto';
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(Math.max(1, w), Math.max(1, h), false);
  }

  get aspect(): number {
    const gc = this.game.canvas;
    return gc.offsetHeight ? gc.offsetWidth / gc.offsetHeight : 16 / 9;
  }
}

let stage: Stage3D | null = null;

export function getStage(game: Phaser.Game): Stage3D {
  return (stage ??= new Stage3D(game));
}
