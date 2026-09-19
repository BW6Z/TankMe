/**
 * Combat tuning — every penetration / damage / module / camera-zoom number
 * lives here so systems stay data-driven and easily adjustable.
 */

export const COMBAT_CONFIG = {
  penetration: {
    /** penetration roll randomization: ±10% around the rated value */
    rollSpread: 0.1,
    /** fraction of penetration lost per 100 m of shell flight */
    lossPer100m: 0.08,
    /** lower clamp of the distance factor (never below 70% of rated pen) */
    minDistFactor: 0.7,
  },
  ricochet: {
    /** impact angle (deg between shell path and plate normal) that forces a ricochet */
    angle: 72,
    /** shells overmatching this multiple of the raw plate thickness never ricochet */
    overmatchMult: 2.2,
  },
  damage: {
    /** damage roll randomization on penetration: ±10% of base */
    spread: 0.1,
    /** critical hit chance once a shell penetrates */
    critChance: 0.15,
    /** critical hit damage multiplier */
    critMult: 1.35,
    /** chance that a critical hit also knocks out a module */
    moduleChance: 0.85,
  },
  modules: {
    track: { duration: 4, damageFrac: 0.35 },
    engine: { duration: 6, speedMult: 0.55 },
    gun: { duration: 6, reloadMult: 1.5 },
  },
  /**
   * Verdict thresholds on the ratio penetration / effective armor used by the
   * armor indicator: ratio >= green → LIKELY, >= yellow → POSSIBLE,
   * >= orange → UNLIKELY, else NO CHANCE.
   */
  verdict: { green: 1.25, yellow: 1.0, orange: 0.8 },
} as const;

export type ModuleId = 'track' | 'engine' | 'gun';

export const MODULE_INFO: Record<ModuleId, { label: string; cssColor: string }> = {
  track: { label: 'TRACK DAMAGED', cssColor: '#ff8a5c' },
  engine: { label: 'ENGINE DAMAGED', cssColor: '#ff6a5c' },
  gun: { label: 'GUN DAMAGED', cssColor: '#ffc45c' },
};

/** Third-person camera & zoom tuning (wheel zoom + RMB gunner sight). */
export const CAMERA_ZOOM = {
  /** camera distance range (m) */
  minDist: 4.8,
  maxDist: 15.5,
  /** field of view range (deg) */
  minFov: 30,
  maxFov: 58,
  /** fraction of the zoom range consumed per wheel notch */
  wheelStep: 0.14,
  /** smoothing rate for the zoom interpolation (higher = snappier) */
  smoothing: 9,
  /** aim sensitivity multiplier at full zoom */
  sensAtFullZoom: 0.4,
} as const;
