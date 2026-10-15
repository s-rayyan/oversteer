import { CARS, MAX_LEVEL, UPGRADES, effectiveStats, getCar, noUpgrades, type CarDef, type CarStats, type Levels, type UpgradeKey } from './cars';

const KEY = 'oversteer.profile.v1';

interface Profile {
  coins: number;
  owned: string[];
  selected: string;
  levels: Record<string, Levels>;
}

const fresh = (): Profile => ({ coins: 0, owned: [CARS[0].id], selected: CARS[0].id, levels: {} });

let cache: Profile | null = null;

function profile(): Profile {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...fresh(), ...(JSON.parse(raw) as Partial<Profile>) };
      if (!p.owned.includes(CARS[0].id)) p.owned.push(CARS[0].id);
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
}

export const getCoins = (): number => profile().coins;
export const owns = (id: string): boolean => profile().owned.includes(id);
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
