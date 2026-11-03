import type Phaser from 'phaser';
import { SceneKey } from '../game/config';

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
