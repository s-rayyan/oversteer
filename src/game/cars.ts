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
  offRoadCap: number; // fraction of top speed kept on grass and gravel
  padGain: number; // boost meter added by a boost pad (0..1)
}

export type CarClassId = 'allrounder' | 'speedster' | 'gripracer' | 'drifter' | 'offroader' | 'booster' | 'agile' | 'hypercar';

export interface CarClass {
  id: CarClassId;
  label: string;
  color: string;
  /** What the class means, in plain words. */
  blurb: string;
  /** The rule a car's *base* stats must satisfy to belong here (checked by `npm run check:cars`). */
  matches: (s: CarStats) => boolean;
}

/**
 * Every car belongs to exactly one class, defined by a rule on its stats. The rules are mutually
 * exclusive, so a car can never be two things at once.
 */
export const CAR_CLASSES: Record<CarClassId, CarClass> = {
  allrounder: {
    id: 'allrounder', label: 'ALL-ROUNDER', color: '#c9d1e3',
    blurb: 'Balanced. Wins on tracks that mix every challenge.',
    matches: (s) => s.maxSpeed >= 120 && s.maxSpeed <= 145 && s.turnRate >= 2.5 && s.turnRate <= 3.0 && s.grip >= 2.2 && s.grip <= 3.0
      && s.accel >= 110 && s.offRoadCap >= 0.5 && s.offRoadCap <= 0.7 && s.padGain >= 0.6,
  },
  speedster: {
    id: 'speedster', label: 'SPEEDSTER', color: '#ffd166',
    blurb: 'Top speed and acceleration, poor turning.',
    matches: (s) => s.maxSpeed >= 140 && s.turnRate <= 2.0 && s.grip <= 2.3,
  },
  gripracer: {
    id: 'gripracer', label: 'GRIP RACER', color: '#4895ef',
    blurb: 'Huge grip. Wins on technical tracks.',
    matches: (s) => s.grip >= 3.5 && s.turnRate < 3.0 && s.boostCharge <= 0.7 && s.offRoadCap < 0.8 && s.maxSpeed < 180,
  },
  drifter: {
    id: 'drifter', label: 'DRIFTER', color: '#f4a261',
    blurb: 'Low grip, fills boost fastest in drift zones.',
    matches: (s) => s.grip <= 1.7 && s.boostCharge >= 1.0,
  },
  offroader: {
    id: 'offroader', label: 'OFF-ROADER', color: '#52b788',
    blurb: 'Keeps its speed on gravel and grass.',
    matches: (s) => s.offRoadCap >= 0.8,
  },
  booster: {
    id: 'booster', label: 'BOOSTER', color: '#e63946',
    blurb: 'Big boost tank; best on boost pads.',
    matches: (s) => s.boostDrain <= 0.3 && s.boostSpeed >= 1.4 && s.maxSpeed < 150,
  },
  agile: {
    id: 'agile', label: 'AGILE', color: '#c77dff',
    blurb: 'Tiny and twitchy. Wins on hairpins.',
    matches: (s) => s.turnRate >= 3.0 && s.maxSpeed <= 170,
  },
  hypercar: {
    id: 'hypercar', label: 'HYPERCAR', color: '#00b4d8',
    blurb: 'Premium all-rounder. Specialists can beat it.',
    matches: (s) => s.maxSpeed >= 145 && s.turnRate < 3.0 && s.grip >= 2.4 && s.grip < 3.5 && s.offRoadCap < 0.8 && s.boostSpeed < 1.5,
  },
};

export interface CarDef {
  id: string;
  name: string;
  blurb: string;
  price: number;
  carClass: CarClassId;
  color: number;
  /** Sprite size in px (default 16x9). */
  size?: readonly [number, number];
  stripe?: number;
  stats: CarStats;
}

const BASE: CarStats = {
  accel: 100, brake: 150, maxSpeed: 115, turnRate: 2.3, grip: 2.4,
  boostCharge: 0.5, boostDrain: 0.5, boostAccel: 1.6, boostSpeed: 1.25, offRoadCap: 0.4, padGain: 0.5,
};

const CAR_LIST: CarDef[] = [
  { id: 'hatch', name: 'Hatchback', blurb: 'Balanced and forgiving. Everyone starts here.', price: 0, carClass: 'allrounder', color: 0xe63946, stats: { ...BASE, maxSpeed: 124, accel: 113, turnRate: 2.68, grip: 2.31, boostCharge: 0.81, boostSpeed: 1.5, offRoadCap: 0.6, padGain: 0.7 } },
  {
    id: 'gripper', name: 'Gripper', blurb: 'Glued to the road.', price: 400, carClass: 'gripracer', color: 0x4895ef,
    stats: { ...BASE, maxSpeed: 138, accel: 119, turnRate: 2.27, grip: 5.0, boostCharge: 0.33, boostDrain: 0.55 },
  },
  {
    id: 'drifter', name: 'Drifter', blurb: 'Slides everywhere and fills boost fast.', price: 600, carClass: 'drifter', color: 0xf4a261,
    stats: { ...BASE, maxSpeed: 135, turnRate: 2.33, grip: 1.61, boostCharge: 1.13, boostDrain: 0.36, boostSpeed: 1.7 },
  },
  {
    id: 'rally', name: 'Rally Truck', blurb: 'Barely cares about grass. Slower on tarmac.', price: 800, carClass: 'offroader', color: 0x52b788,
    stats: { ...BASE, maxSpeed: 121, accel: 104, grip: 2.2, offRoadCap: 0.8 },
  },
  {
    id: 'dragster', name: 'Dragster', blurb: 'Rocket on the straights. Turning is a suggestion.', price: 1200, carClass: 'speedster', color: 0xffd166,
    stats: { ...BASE, maxSpeed: 164, accel: 152, brake: 130, turnRate: 1.9, grip: 2.0 },
  },
  {
    id: 'bruiser', name: 'Bruiser', blurb: 'Huge boost tank and a bigger kick.', price: 1500, carClass: 'booster', color: 0x8d99ae,
    stats: { ...BASE, maxSpeed: 148, accel: 130, boostCharge: 0.6, boostDrain: 0.3, boostSpeed: 1.97, padGain: 0.6 },
  },
  // ---- more cars, roughly cheapest to priciest ----
  {
    id: 'kart', name: 'Go-Kart', blurb: 'Tiny, twitchy and glued to the floor.', price: 300, carClass: 'agile', color: 0xffb703, size: [12, 7], stripe: 0x14121f,
    stats: { ...BASE, maxSpeed: 117, accel: 165, turnRate: 3.09, grip: 4.03, boostSpeed: 1.15 },
  },
  {
    id: 'sedan', name: 'Sedan', blurb: 'A touch better than the hatchback in every way.', price: 250, carClass: 'allrounder', color: 0x2ec4b6,
    stats: { ...BASE, maxSpeed: 128, accel: 116, turnRate: 2.74, grip: 2.51, boostCharge: 0.81, boostSpeed: 1.5, offRoadCap: 0.6, padGain: 0.7 },
  },
  {
    id: 'buggy', name: 'Buggy', blurb: 'Treats grass like a road. Light and bouncy.', price: 700, carClass: 'offroader', color: 0xcaa56b, size: [14, 9], stripe: 0x6b4226,
    stats: { ...BASE, maxSpeed: 118, accel: 122, turnRate: 2.5, grip: 2, offRoadCap: 0.9 },
  },
  {
    id: 'coupe', name: 'Coupe', blurb: 'Sporty all-rounder with decent boost.', price: 900, carClass: 'allrounder', color: 0xc77dff,
    stats: { ...BASE, maxSpeed: 140, accel: 130, turnRate: 2.8, grip: 2.7, boostCharge: 0.9, boostSpeed: 1.5, offRoadCap: 0.6, padGain: 0.7 },
  },
  {
    id: 'muscle', name: 'Muscle', blurb: 'Loud, heavy and always sideways.', price: 1000, carClass: 'speedster', color: 0x9d0208, size: [18, 10], stripe: 0xf1faee,
    stats: { ...BASE, maxSpeed: 153, accel: 141, brake: 140, turnRate: 2.0, grip: 1.9, boostCharge: 0.4 },
  },
  {
    id: 'tank', name: 'Tank', blurb: 'Plows through grass and boosts for ages.', price: 2000, carClass: 'offroader', color: 0x4f772d, size: [18, 11], stripe: 0x90a955,
    stats: { ...BASE, maxSpeed: 146, accel: 113, turnRate: 2, grip: 3.2, boostDrain: 0.25, boostSpeed: 1.3, offRoadCap: 0.95 },
  },
  {
    id: 'rocket', name: 'Rocket', blurb: 'Absurd top speed. Steering optional.', price: 2500, carClass: 'speedster', color: 0xf1faee, size: [18, 8], stripe: 0xe63946,
    stats: { ...BASE, maxSpeed: 175, accel: 190, turnRate: 1.8, grip: 2.2, boostSpeed: 1.372, boostCharge: 0.6, boostDrain: 0.23 },
  },
  {
    id: 'phantom', name: 'Phantom', blurb: 'Precise and fast. Rewards clean drifts.', price: 3200, carClass: 'gripracer', color: 0x3a0ca3, size: [17, 9], stripe: 0xc77dff,
    stats: { ...BASE, maxSpeed: 172, accel: 148, turnRate: 2.53, grip: 4.8, boostSpeed: 1.35, boostCharge: 0.7, boostDrain: 0.265 },
  },
  {
    id: 'comet', name: 'Comet', blurb: 'Darts through corners and burns on boost.', price: 4200, carClass: 'agile', color: 0x00b4d8, size: [17, 9], stripe: 0xffffff,
    stats: { ...BASE, maxSpeed: 165, accel: 150, turnRate: 3.3, grip: 2.6, boostCharge: 1.1, boostDrain: 0.28, boostSpeed: 1.39, padGain: 0.9 },
  },
  {
    id: 'legend', name: 'Legend', blurb: 'The best car in the game. Gold paint included.', price: 6500, carClass: 'hypercar', color: 0xd4af37, size: [18, 9], stripe: 0x14121f,
    stats: { ...BASE, maxSpeed: 170, accel: 155, turnRate: 2.8, grip: 3.4, boostCharge: 1.0, boostDrain: 0.3, boostSpeed: 1.4, offRoadCap: 0.6 },
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
