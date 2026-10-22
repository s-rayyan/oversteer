const KEY = 'oversteer.tutorial.v1';

/** True once the player has been shown the tutorial (finished or skipped). */
export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // can't remember either way, so never force it
  }
}

export function markTutorialSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

const GIFT_KEY = 'oversteer.tutorial.gift.v1';
/** Coins handed out for finishing the tutorial, once per device, so a car can be bought and maxed straight away. */
export const TUTORIAL_GIFT = 7000;

/** True the first time it's called on this device; the caller then pays out TUTORIAL_GIFT. */
export function claimTutorialGift(): boolean {
  try {
    if (localStorage.getItem(GIFT_KEY) === '1') return false;
    localStorage.setItem(GIFT_KEY, '1');
    return true;
  } catch {
    return false; // can't remember either way, so never pay out twice
  }
}
