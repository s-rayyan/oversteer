// Pure maths (no Phaser): special stretches of road, given as fractions (0..1) of the lap from the start line.

export interface SurfaceDef {
  /** Gravel sections: capped like grass by the car's offRoadCap, so off-roaders keep their speed. */
  rough?: ReadonlyArray<readonly [number, number]>;
  /** Boost pads (start fractions, ~40 px long): add padGain to the boost meter once per pass. */
  pads?: ReadonlyArray<number>;
  /** Drift zones: boost charges from raw sideways slip, so low-grip cars fill it fast. */
  zones?: ReadonlyArray<readonly [number, number]>;
}

export interface SurfaceFlags {
  rough: boolean;
  pad: boolean;
  zone: boolean;
}

const PAD_SAMPLES = 10; // 40 px

/** Per-sample surface flags for a road of `n` samples. */
export function surfaceFlags(n: number, def: SurfaceDef): SurfaceFlags[] {
  const out: SurfaceFlags[] = Array.from({ length: n }, () => ({ rough: false, pad: false, zone: false }));
  const mark = (ranges: ReadonlyArray<readonly [number, number]> | undefined, key: 'rough' | 'zone') => {
    for (const [a, b] of ranges ?? []) {
      for (let i = Math.round(a * n); i < Math.round(b * n); i++) out[i % n][key] = true;
    }
  };
  mark(def.rough, 'rough');
  mark(def.zones, 'zone');
  for (const f of def.pads ?? []) {
    for (let k = 0; k < PAD_SAMPLES; k++) out[(Math.round(f * n) + k) % n].pad = true;
  }
  return out;
}
