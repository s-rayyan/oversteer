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
