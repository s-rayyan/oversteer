// Pure logic (no DOM, no Firebase) for keeping one account's save in step across devices. Tested by
// scripts/testCloudMerge.ts.
import { mergeSaves, type SaveData } from './saveMerge.ts';

const PLAYER = 'oversteer.player';
const PROFILE = 'oversteer.profile.v1';
const RECORDS = 'oversteer.records.v1';

/** What goes into the online save: name, coins/cars/upgrades, records. (Ghosts are big and re-recorded.) */
export const CLOUD_KEYS = [PLAYER, PROFILE, RECORDS] as const;

export function pickCloud(save: SaveData): SaveData {
  const out: SaveData = {};
  for (const k of CLOUD_KEYS) if (save[k] !== undefined) out[k] = save[k];
  return out;
}

export function coinsOf(save: SaveData): number {
  try {
    const p = JSON.parse(save[PROFILE] ?? '{}') as { coins?: number };
    return typeof p.coins === 'number' ? p.coins : 0;
  } catch {
    return 0;
  }
}

/**
 * Combines this device's save with the account's online save.
 *
 * Best times, owned cars and upgrade levels merge as best-of / union, and this device keeps its own name and
 * selected car. Coins are a balance that every device spends from, so they use a three-way rule: the online
 * balance plus whatever this device earned or spent since it last synced (`baseCoins`). Syncing again
 * without playing therefore never changes anything, and two devices never double-count each other's coins.
 * A device that has never synced has baseCoins 0, so its whole balance joins the account once.
 */
export function mergeCloud(local: SaveData, cloud: SaveData | null, baseCoins: number): { merged: SaveData; coins: number } {
  const mine = pickCloud(local);
  if (!cloud) return { merged: mine, coins: coinsOf(mine) };
  const m = mergeSaves(mine, pickCloud(cloud), 'cloud');
  const coins = Math.max(0, Math.floor(coinsOf(cloud) + (coinsOf(mine) - baseCoins)));
  try {
    const p = JSON.parse(m[PROFILE] ?? '{}') as Record<string, unknown>;
    m[PROFILE] = JSON.stringify({ ...p, coins });
  } catch {
    /* keep the merged profile as it is */
  }
  return { merged: pickCloud(m), coins };
}
