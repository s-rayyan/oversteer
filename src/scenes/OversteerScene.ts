import { SceneKey } from '../game/config';
import { EndlessScene } from './EndlessScene';

/**
 * OVERSTEER: the endless road, but the throttle is held for you and boost fires automatically
 * whenever there's any in the tank. Boost is stronger and refills faster (by drifting), but it
 * can still run dry. All you control is steering and the handbrake.
 */
export class OversteerScene extends EndlessScene {
  constructor() {
    super(SceneKey.Oversteer);
    this.mode = 'oversteer';
    this.autoDrive = true;
  }
}
