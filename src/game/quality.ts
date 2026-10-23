// Visual-effects level. "Low" drops the purely decorative per-frame work (particles, skid marks, screen shake, the
// speed zoom and vignette) for slow computers. Every visit starts with full effects: it switches on by itself when
// the frame rate stays low and back off when it has been fast for a while (see fpsMeter.ts), and Q flips it by hand. It is deliberately not remembered, because how
// fast a computer runs changes (battery saver, other tabs, plugged in or not).
export const quality = { low: false };

export function setLowQuality(low: boolean): void {
  quality.low = low;
}

try {
  localStorage.removeItem('oversteerLowFx'); // an earlier version remembered it
} catch {
  /* storage unavailable */
}
