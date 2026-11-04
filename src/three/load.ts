import type Phaser from 'phaser';
import { SceneKey } from '../game/config';
import type { Showcase } from './showcase';

let loading: Promise<void> | null = null;

/**
 * The 3D game (three.js and the 3D race scene) is a separate download, fetched the first time it is needed, so the
 * 2D game never pays for it. Resolves once the 3D race scene is registered and a 3D renderer exists; rejects with a
 * message fit for the screen if this browser can't draw 3D.
 */
export function ensure3D(game: Phaser.Game): Promise<void> {
  loading ??= (async () => {
    const [{ Race3DScene }, { getStage }] = await Promise.all([import('../scenes/Race3DScene'), import('./stage')]);
    try {
      getStage(game);
    } catch (e) {
      console.error('[3d]', e);
      throw new Error('This browser cannot draw 3D (WebGL is off or unavailable).');
    }
    if (!game.scene.keys[SceneKey.Race3D]) game.scene.add(SceneKey.Race3D, Race3DScene, false);
  })();
  loading.catch(() => { loading = null; }); // a failed download can be tried again
  return loading;
}

/**
 * Gets a track's 3D world ready before its race starts: builds it and compiles its shaders (see prepare.ts). A
 * failure here only costs a stutter later, so it never stops the race.
 */
export async function prepare3D(game: Phaser.Game, trackId: string): Promise<void> {
  await ensure3D(game);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // let "LOADING TRACK" show first
  try {
    const { prepareTrack } = await import('./prepare');
    await prepareTrack(game, trackId);
  } catch (e) {
    console.warn('[3d prepare]', e);
  }
}

/** A 3D turntable for the garage and paint shop (see showcase.ts). */
export async function showcase3D(game: Phaser.Game, rect: { x: number; y: number; w: number; h: number }): Promise<Showcase> {
  await ensure3D(game);
  const { Showcase } = await import('./showcase');
  return new Showcase(game, rect);
}
