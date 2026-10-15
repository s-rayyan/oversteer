// Pure data (no Phaser) so it can be used from any scene.
export interface CarStats {
  accel: number; // px/s^2 under throttle
  brake: number;
  maxSpeed: number; // px/s
  turnRate: number; // rad/s at speed
  grip: number; // higher = grippier, lower = drifts more
  boostCharge: number; // meter/s at full slip
  boostDrain: number; // meter/s while boosting (lower = longer boost)
  boostAccel: number; // accel multiplier while boosting
  boostSpeed: number; // top-speed multiplier while boosting
  offRoadCap: number; // fraction of top speed kept on grass
}

export interface CarDef {
  id: string;
  name: string;
  blurb: string;
  price: number;
  color: number;
  /** Sprite size in px (default 16x9). */
  size?: readonly [number, number];
  stripe?: number;
  stats: CarStats;
}

const BASE: CarStats = {
  accel: 100, brake: 150, maxSpeed: 115, turnRate: 2.3, grip: 2.4,
  boostCharge: 0.5, boostDrain: 0.5, boostAccel: 1.6, boostSpeed: 1.25, offRoadCap: 0.4,
};

const CAR_LIST: CarDef[] = [
  { id: 'hatch', name: 'Hatchback', blurb: 'Balanced and forgiving. Everyone starts here.', price: 0, color: 0xe63946, stats: BASE },
  {
    id: 'gripper', name: 'Gripper', blurb: 'Glued to the road. Fast and stable, slow to charge boost.', price: 400, color: 0x4895ef,
    stats: { ...BASE, maxSpeed: 126, accel: 105, turnRate: 2.5, grip: 3.6, boostCharge: 0.35, boostDrain: 0.55 },
  },
  {
    id: 'drifter', name: 'Drifter', blurb: 'Slides everywhere and fills boost fast.', price: 600, color: 0xf4a261,
    stats: { ...BASE, maxSpeed: 112, turnRate: 2.6, grip: 1.6, boostCharge: 0.9 },
  },
  {
    id: 'rally', name: 'Rally Truck', blurb: 'Barely cares about grass. Slower on tarmac.', price: 800, color: 0x52b788,
    stats: { ...BASE, maxSpeed: 108, accel: 95, grip: 2.2, offRoadCap: 0.8 },
  },
  {
    id: 'dragster', name: 'Dragster', blurb: 'Rocket on the straights. Turning is a suggestion.', price: 1200, color: 0xffd166,
    stats: { ...BASE, maxSpeed: 150, accel: 140, brake: 130, turnRate: 1.9, grip: 2.0 },
  },
  {
    id: 'bruiser', name: 'Bruiser', blurb: 'Huge boost tank and a bigger kick.', price: 1500, color: 0x8d99ae,
    stats: { ...BASE, maxSpeed: 125, accel: 115, boostCharge: 0.6, boostDrain: 0.3, boostSpeed: 1.4 },
  },
  // ---- more cars, roughly cheapest to priciest ----
  {
    id: 'kart', name: 'Go-Kart', blurb: 'Tiny, twitchy and glued to the floor. Low top speed.', price: 300, color: 0xffb703, size: [12, 7], stripe: 0x14121f,
    stats: { ...BASE, maxSpeed: 100, accel: 130, turnRate: 3.0, grip: 3.4, boostSpeed: 1.15 },
  },
  {
    id: 'sedan', name: 'Sedan', blurb: 'A touch better than the hatchback in every way.', price: 250, color: 0x2ec4b6,
    stats: { ...BASE, maxSpeed: 119, accel: 103, turnRate: 2.35, grip: 2.6 },
  },
  {
    id: 'buggy', name: 'Buggy', blurb: 'Treats grass like a road. Light and bouncy.', price: 700, color: 0xcaa56b, size: [14, 9], stripe: 0x6b4226,
    stats: { ...BASE, maxSpeed: 105, accel: 112, turnRate: 2.5, grip: 2.0, offRoadCap: 0.9 },
  },
  {
    id: 'coupe', name: 'Coupe', blurb: 'Sporty all-rounder with decent boost.', price: 900, color: 0xc77dff,
    stats: { ...BASE, maxSpeed: 130, accel: 115, turnRate: 2.4, grip: 2.8, boostCharge: 0.55 },
  },
  {
    id: 'muscle', name: 'Muscle', blurb: 'Loud, heavy and sideways. Great straight-line speed.', price: 1000, color: 0x9d0208, size: [18, 10], stripe: 0xf1faee,
    stats: { ...BASE, maxSpeed: 140, accel: 130, brake: 140, turnRate: 2.0, grip: 1.9, boostCharge: 0.4 },
  },
  {
    id: 'tank', name: 'Tank', blurb: 'Plows through grass and boosts for ages.', price: 2000, color: 0x4f772d, size: [18, 11], stripe: 0x90a955,
    stats: { ...BASE, maxSpeed: 110, accel: 90, turnRate: 2.0, grip: 3.2, boostDrain: 0.25, boostSpeed: 1.3, offRoadCap: 0.95 },
  },
  {
    id: 'rocket', name: 'Rocket', blurb: 'Absurd top speed. Steering optional.', price: 2500, color: 0xf1faee, size: [18, 8], stripe: 0xe63946,
    stats: { ...BASE, maxSpeed: 160, accel: 150, turnRate: 1.8, grip: 2.2, boostSpeed: 1.35, boostCharge: 0.45 },
  },
  {
    id: 'phantom', name: 'Phantom', blurb: 'Precise and fast. Rewards clean drifts.', price: 3200, color: 0x3a0ca3, size: [17, 9], stripe: 0xc77dff,
    stats: { ...BASE, maxSpeed: 140, accel: 125, turnRate: 2.8, grip: 3.0, boostCharge: 0.7, boostDrain: 0.4 },
  },
  {
    id: 'comet', name: 'Comet', blurb: 'Fast, grippy and a great boost. Almost the best.', price: 4200, color: 0x00b4d8, size: [17, 9], stripe: 0xffffff,
    stats: { ...BASE, maxSpeed: 155, accel: 140, turnRate: 2.6, grip: 3.0, boostCharge: 0.8, boostDrain: 0.35, boostSpeed: 1.35 },
  },
  {
    id: 'legend', name: 'Legend', blurb: 'The best car in the game. Gold paint included.', price: 6500, color: 0xd4af37, size: [18, 9], stripe: 0x14121f,
    stats: { ...BASE, maxSpeed: 170, accel: 155, turnRate: 2.8, grip: 3.3, boostCharge: 1.0, boostDrain: 0.3, boostSpeed: 1.4, offRoadCap: 0.6 },
  },
];

/** Cheapest first, so the garage reads like a progression. */
export const CARS: CarDef[] = [...CAR_LIST].sort((a, b) => a.price - b.price);

export type UpgradeKey = 'engine' | 'tires' | 'turbo';
export type Levels = Record<UpgradeKey, number>;
export const MAX_LEVEL = 3;

export const UPGRADES: Record<UpgradeKey, { name: string; costs: number[]; blurb: string }> = {
  engine: { name: 'Engine', costs: [100, 200, 350], blurb: '+accel, +top speed' },
  tires: { name: 'Tires', costs: [100, 200, 350], blurb: '+grip, +turning' },
  turbo: { name: 'Turbo', costs: [120, 240, 400], blurb: 'faster charge, longer boost' },
};

export const UPGRADE_KEYS = Object.keys(UPGRADES) as UpgradeKey[];
export const noUpgrades = (): Levels => ({ engine: 0, tires: 0, turbo: 0 });

export function getCar(id: string): CarDef {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}

/** Base stats with upgrade levels applied. */
export function effectiveStats(car: CarDef, lv: Levels): CarStats {
  const s = car.stats;
  return {
    ...s,
    accel: s.accel * (1 + 0.04 * lv.engine),
    maxSpeed: s.maxSpeed * (1 + 0.03 * lv.engine),
    grip: s.grip * (1 + 0.06 * lv.tires),
    turnRate: s.turnRate * (1 + 0.03 * lv.tires),
    boostCharge: s.boostCharge * (1 + 0.08 * lv.turbo),
    boostDrain: s.boostDrain * (1 - 0.06 * lv.turbo),
  };
}

/** 0..1 values for the garage stat bars. */
export function statBars(s: CarStats): Array<[string, number]> {
  const clamp = (v: number) => Math.max(0.04, Math.min(1, v));
  return [
    ['SPEED', clamp(s.maxSpeed / 170)],
    ['ACCEL', clamp(s.accel / 160)],
    ['TURN', clamp(s.turnRate / 3)],
    ['GRIP', clamp(s.grip / 4)],
    ['BOOST', clamp((s.boostCharge / s.boostDrain) / 5)],
  ];
}

export const RACE_PAY = { Easy: 50, Medium: 90, Hard: 140, Expert: 200 } as const;
