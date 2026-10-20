// Pure logic (no DOM, no Phaser) for moving a save from one browser storage into another without losing
// progress on either side. Used by saveTransfer.ts; tested by scripts/testSaveMerge.ts.

/** A save is just every `oversteer.*` localStorage entry, raw. */
export type SaveData = Record<string, string>;

export const SAVE_PREFIX = 'oversteer.';
/** Coins already counted from each source save, so importing the same save twice can't double the coins. */
export const IMPORTED_KEY = 'oversteer.importedCoins';
/** A source save's stable transfer id (kept in the embedded copy, never transferred). */
export const TRANSFER_ID_KEY = 'oversteer.transferId';
/** Set in the old (embedded) copy once its save has been handed over. Never transferred. */
export const MIGRATED_KEY = 'oversteer.migratedAt';
/** Which local bests the global leaderboard already has (per browser, since the leaderboard identity is too). Never transferred. */
export const LB_SYNCED_KEY = 'oversteer.lbSynced';

/** Things that describe this one device's sign-in or pending chores: never carried to another address or device. */
export const DEVICE_ONLY_KEYS: readonly string[] = ['oversteer.accountLabel', 'oversteer.cloudSyncedAt', 'oversteer.renamePending', 'oversteer.lbPending'];

const PROFILE = 'oversteer.profile.v1';
const RECORDS = 'oversteer.records.v1';
const PLAYER = 'oversteer.player';
const GHOST = 'oversteer.ghost.';

interface Profile {
  coins?: number;
  owned?: string[];
  selected?: string;
  levels?: Record<string, Record<string, number>>;
}
interface Records {
  tracks?: Record<string, { best?: number; bestLap?: number }>;
  endless?: number;
  oversteer?: number;
  [k: string]: unknown;
}

const parse = <T>(raw: string | undefined): T | null => {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};
const lower = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.min(a, b));
const higher = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

function mergeProfile(a: Profile, b: Profile, newCoins: number): Profile {
  const levels: Record<string, Record<string, number>> = { ...(a.levels ?? {}) };
  for (const [car, lv] of Object.entries(b.levels ?? {})) {
    const mine = levels[car] ?? {};
    const out: Record<string, number> = { ...mine };
    for (const [k, v] of Object.entries(lv)) out[k] = Math.max(mine[k] ?? 0, v);
    levels[car] = out;
  }
  return {
    ...b,
    ...a,
    // Two separate playthroughs: keep the coins earned in both (only coins not already brought over).
    coins: (a.coins ?? 0) + newCoins,
    owned: [...new Set([...(a.owned ?? []), ...(b.owned ?? [])])],
    selected: a.selected ?? b.selected,
    levels,
  };
}

function mergeRecords(a: Records, b: Records): Records {
  const tracks: NonNullable<Records['tracks']> = { ...(a.tracks ?? {}) };
  for (const [id, r] of Object.entries(b.tracks ?? {})) {
    const mine = tracks[id] ?? {};
    tracks[id] = { best: lower(mine.best, r.best), bestLap: lower(mine.bestLap, r.bestLap) };
  }
  return { ...b, ...a, tracks, endless: higher(a.endless, b.endless), oversteer: higher(a.oversteer, b.oversteer) };
}

/**
 * Merges an incoming save into the current one, keeping the best of both:
 * best times and distances, the faster ghost, every owned car, the higher upgrade level, the sum of coins.
 * `current` wins for preferences (player name, selected car). Re-applying a save from the same source is safe:
 * everything else is a best-of or a union, and only coins earned since the last transfer are added.
 */
export function mergeSaves(current: SaveData, incoming: SaveData, transferId: string): SaveData {
  const counted = parse<Record<string, number>>(current[IMPORTED_KEY]) ?? {};
  const incomingCoins = parse<Profile>(incoming[PROFILE])?.coins ?? 0;
  const newCoins = Math.max(0, incomingCoins - (counted[transferId] ?? 0));

  const out: SaveData = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (!key.startsWith(SAVE_PREFIX) || key === MIGRATED_KEY || key === IMPORTED_KEY || key === TRANSFER_ID_KEY || key === LB_SYNCED_KEY || DEVICE_ONLY_KEYS.includes(key)) continue;
    const mine = current[key];
    if (key === PROFILE) {
      const b = parse<Profile>(value);
      if (!b) continue;
      const a = mine === undefined ? {} : parse<Profile>(mine);
      out[key] = a ? JSON.stringify(mergeProfile(a, b, newCoins)) : mine;
      continue;
    }
    if (mine === undefined) {
      out[key] = value;
      continue;
    }
    if (key === RECORDS) {
      const a = parse<Records>(mine), b = parse<Records>(value);
      out[key] = a && b ? JSON.stringify(mergeRecords(a, b)) : mine;
    } else if (key === PLAYER) {
      out[key] = mine.trim() ? mine : value;
    } else if (key.startsWith(GHOST)) {
      const a = parse<{ time?: number }>(mine), b = parse<{ time?: number }>(value);
      out[key] = b?.time !== undefined && (a?.time === undefined || b.time < a.time) ? value : mine;
    }
    // any other key: keep what is already here
  }
  out[IMPORTED_KEY] = JSON.stringify({ ...counted, [transferId]: Math.max(counted[transferId] ?? 0, incomingCoins) });
  return out;
}

/** True if this save has any progress worth moving. */
export function hasProgress(save: SaveData): boolean {
  return Object.keys(save).some((k) => k.startsWith(SAVE_PREFIX) && k !== MIGRATED_KEY && k !== IMPORTED_KEY && k !== TRANSFER_ID_KEY && k !== LB_SYNCED_KEY && !DEVICE_ONLY_KEYS.includes(k));
}

/** One-line description of a save for the launcher screen. */
export function describeSave(save: SaveData): string {
  const profile = parse<Profile>(save[PROFILE]);
  const records = parse<Records>(save[RECORDS]);
  const parts: string[] = [];
  if (profile?.coins) parts.push(`${profile.coins} coins`);
  if (profile?.owned?.length) parts.push(`${profile.owned.length} car${profile.owned.length === 1 ? '' : 's'}`);
  const recs = Object.keys(records?.tracks ?? {}).length;
  if (recs) parts.push(`${recs} track record${recs === 1 ? '' : 's'}`);
  const ghosts = Object.keys(save).filter((k) => k.startsWith(GHOST)).length;
  if (ghosts) parts.push(`${ghosts} ghost${ghosts === 1 ? '' : 's'}`);
  return parts.join(', ');
}
