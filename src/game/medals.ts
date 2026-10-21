// Bronze, silver and gold race times, measured against the starter Hatchback driven by the benchmark bot
// (src/game/medalTimes.ts). A better car, upgrades and good drifting all make the harder medals easier.
import { MEDAL_BASE } from './medalTimes';

export const MEDAL_NAME = ['NO MEDAL', 'BRONZE', 'SILVER', 'GOLD'] as const;
export const MEDAL_COLOR = ['#555a73', '#cd7f32', '#c0c8d4', '#ffd166'] as const;
/** Coins for the first time you reach each medal on a track. */
export const MEDAL_PAY = [0, 40, 80, 150] as const;

/**
 * Times as a multiple of the bot's. The bot never boosts or drifts for speed, so gold (a little faster than it) takes
 * good boost management or a better car, silver is a tidy run, and bronze is a clean, unhurried one.
 */
const FACTOR = { bronze: 1.25, silver: 1.08, gold: 0.98 };

export interface MedalTimes {
  gold: number;
  silver: number;
  bronze: number;
}

export function medalTimes(trackId: string): MedalTimes | null {
  const base = MEDAL_BASE[trackId];
  if (base === undefined) return null;
  const r = (f: number) => Math.round(base * f * 10) / 10;
  return { gold: r(FACTOR.gold), silver: r(FACTOR.silver), bronze: r(FACTOR.bronze) };
}

/** 0 = none, 1 = bronze, 2 = silver, 3 = gold for a total race time in seconds. */
export function medalFor(trackId: string, time: number | undefined): number {
  const m = medalTimes(trackId);
  if (!m || time === undefined) return 0;
  return time <= m.gold ? 3 : time <= m.silver ? 2 : time <= m.bronze ? 1 : 0;
}
