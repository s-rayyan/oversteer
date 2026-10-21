// Pure data: paint jobs and tyre-smoke colours you can buy with coins. They change looks only, never the stats.

export interface Paint {
  id: string;
  name: string;
  price: number;
  /** Body colour used instead of the car's own; null keeps the stock colour. */
  color: number | null;
}

export const PAINTS: Paint[] = [
  { id: 'stock', name: 'Stock', price: 0, color: null },
  { id: 'midnight', name: 'Midnight', price: 150, color: 0x2b2d42 },
  { id: 'hotpink', name: 'Hot Pink', price: 200, color: 0xff4d9d },
  { id: 'lime', name: 'Lime Zest', price: 200, color: 0x9ef01a },
  { id: 'ice', name: 'Ice Blue', price: 250, color: 0x8ecae6 },
  { id: 'sunset', name: 'Sunset', price: 250, color: 0xff7b00 },
  { id: 'violet', name: 'Violet', price: 300, color: 0x7b2cbf },
  { id: 'chrome', name: 'Chrome', price: 400, color: 0xced4da },
  { id: 'gold', name: 'Gold Leaf', price: 500, color: 0xd4af37 },
];

export interface SmokeStyle {
  id: string;
  name: string;
  price: number;
  /** Particle tint (one colour, or a set the particles pick from). */
  tint: number | number[];
  /** Colour of the swatch in the shop. */
  swatch: number;
}

export const SMOKES: SmokeStyle[] = [
  { id: 'stock', name: 'White', price: 0, tint: 0xdfe7ef, swatch: 0xdfe7ef },
  { id: 'pink', name: 'Bubblegum', price: 120, tint: 0xff8fc8, swatch: 0xff8fc8 },
  { id: 'cyan', name: 'Ice', price: 120, tint: 0x7be0ff, swatch: 0x7be0ff },
  { id: 'toxic', name: 'Toxic', price: 180, tint: 0x9ef01a, swatch: 0x9ef01a },
  { id: 'blood', name: 'Inferno', price: 180, tint: [0xe63946, 0xf4a261], swatch: 0xe63946 },
  { id: 'rainbow', name: 'Rainbow', price: 300, tint: [0xe63946, 0xffd166, 0x52b788, 0x4895ef, 0xc77dff], swatch: 0xffd166 },
];

export const getPaintDef = (id: string): Paint => PAINTS.find((p) => p.id === id) ?? PAINTS[0];
export const getSmokeDef = (id: string): SmokeStyle => SMOKES.find((s) => s.id === id) ?? SMOKES[0];
