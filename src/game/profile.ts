import { saveChanged } from './cloudHook';
import { CARS, MAX_LEVEL, UPGRADES, effectiveStats, getCar, noUpgrades, type CarDef, type CarStats, type Levels, type UpgradeKey } from './cars';
import { PAINTS, SMOKES, getPaintDef, getSmokeDef, type Paint, type SmokeStyle } from './cosmetics';

const KEY = 'oversteer.profile.v1';

interface Profile {
  coins: number;
  owned: string[];
  selected: string;
  levels: Record<string, Levels>;
  /** Paint jobs and smoke colours bought, and the ones in use (cosmetics.ts). */
  paints: string[];
  paint: string;
  smokes: string[];
  smoke: string;
  /** Ids of completed challenges (challenges.ts). */
  done: string[];
}

const fresh = (): Profile => ({
  coins: 0, owned: [CARS[0].id], selected: CARS[0].id, levels: {},
  paints: [PAINTS[0].id], paint: PAINTS[0].id, smokes: [SMOKES[0].id], smoke: SMOKES[0].id, done: [],
});

let cache: Profile | null = null;

function profile(): Profile {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...fresh(), ...(JSON.parse(raw) as Partial<Profile>) };
      if (!p.owned.includes(CARS[0].id)) p.owned.push(CARS[0].id);
      if (!p.paints.includes(PAINTS[0].id)) p.paints.push(PAINTS[0].id);
      if (!p.smokes.includes(SMOKES[0].id)) p.smokes.push(SMOKES[0].id);
      return (cache = p);
    }
  } catch {
    /* unreadable save: start fresh */
  }
  return (cache = fresh());
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile()));
  } catch {
    /* storage unavailable */
  }
  saveChanged();
}

/** Forget the in-memory copy so the next read comes from storage (after the online save was merged in). */
export function reloadProfile(): void {
  cache = null;
}

export const getCoins = (): number => profile().coins;
export const owns = (id: string): boolean => profile().owned.includes(id);
export const ownedCount = (): number => profile().owned.length;
export const selectedCar = (): CarDef => getCar(profile().selected);
export const getLevels = (id: string): Levels => ({ ...noUpgrades(), ...profile().levels[id] });
export const equippedStats = (): CarStats => effectiveStats(selectedCar(), getLevels(selectedCar().id));

export function addCoins(n: number): void {
  if (n <= 0) return;
  profile().coins += Math.floor(n);
  save();
}

export function buyCar(id: string): boolean {
  const p = profile();
  const car = getCar(id);
  if (p.owned.includes(id) || p.coins < car.price) return false;
  p.coins -= car.price;
  p.owned.push(id);
  p.selected = id;
  save();
  return true;
}

export function selectCar(id: string): boolean {
  const p = profile();
  if (!p.owned.includes(id)) return false;
  p.selected = id;
  save();
  return true;
}

/** Cost of the next level, or null when maxed. */
export function upgradeCost(id: string, key: UpgradeKey): number | null {
  const lv = getLevels(id)[key];
  return lv >= MAX_LEVEL ? null : UPGRADES[key].costs[lv];
}

export function buyUpgrade(id: string, key: UpgradeKey): boolean {
  const p = profile();
  const cost = upgradeCost(id, key);
  if (!p.owned.includes(id) || cost === null || p.coins < cost) return false;
  p.coins -= cost;
  p.levels[id] = { ...getLevels(id), [key]: getLevels(id)[key] + 1 };
  save();
  return true;
}

// ---------- cosmetics ----------

export type StyleKind = 'paint' | 'smoke';

const shelf = (kind: StyleKind): readonly (Paint | SmokeStyle)[] => (kind === 'paint' ? PAINTS : SMOKES);

export function ownsStyle(kind: StyleKind, id: string): boolean {
  const p = profile();
  return (kind === 'paint' ? p.paints : p.smokes).includes(id);
}

export const equippedPaint = (): Paint => getPaintDef(profile().paint);
export const equippedSmoke = (): SmokeStyle => getSmokeDef(profile().smoke);
export const equippedStyle = (kind: StyleKind): string => (kind === 'paint' ? profile().paint : profile().smoke);

/** Buys (if needed) and equips a paint job or smoke colour; false when unknown or too expensive. */
export function buyStyle(kind: StyleKind, id: string): boolean {
  const item = shelf(kind).find((i) => i.id === id);
  const p = profile();
  if (!item) return false;
  const owned = kind === 'paint' ? p.paints : p.smokes;
  if (!owned.includes(id)) {
    if (p.coins < item.price) return false;
    p.coins -= item.price;
    owned.push(id);
  }
  if (kind === 'paint') p.paint = id;
  else p.smoke = id;
  save();
  return true;
}

/** Equips something already owned. */
export function equipStyle(kind: StyleKind, id: string): boolean {
  return ownsStyle(kind, id) && buyStyle(kind, id);
}

// ---------- challenges ----------

export const challengeDone = (id: string): boolean => profile().done.includes(id);
export const challengesDoneCount = (): number => profile().done.length;

/** Marks a challenge complete and pays its reward; false when it was already done. */
export function completeChallenge(id: string, reward: number): boolean {
  const p = profile();
  if (p.done.includes(id)) return false;
  p.done.push(id);
  p.coins += Math.floor(reward);
  save();
  return true;
}
