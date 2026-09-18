/** Power-up definitions and spawn system tuning. */

export type PowerupId = 'damage' | 'defense' | 'health' | 'invisibility';

export interface PowerupDef {
  id: PowerupId;
  name: string;
  /** tint used for crate, beam, HUD chip */
  color: number;
  cssColor: string;
  /** relative spawn weight */
  weight: number;
  /** seconds; 0 = instant effect */
  duration: number;
  desc: string;
}

export const POWERUP_CONFIG = {
  /** seconds between spawn attempts */
  spawnInterval: 11,
  /** delay before the first drop after battle start */
  firstDelay: 4,
  /** seconds an unclaimed crate stays on the field */
  lifetime: 26,
  /** pickup distance (m) */
  pickupRadius: 3.6,
  /** max crates on the field at once */
  maxActive: 4,
  /** effect magnitudes */
  damageBoost: 1.3,
  defenseBoost: 0.6, // multiplier applied to incoming damage
  healFraction: 0.25,
  /** how far an invisible tank can be detected by AI (m) */
  invisDetectionRange: 32,
  invisSelfAlpha: 0.16,
} as const;

export const POWERUPS: PowerupDef[] = [
  { id: 'damage', name: 'DAMAGE BOOST', color: 0xff7a2a, cssColor: '#ff7a2a', weight: 0.3, duration: 15, desc: '+30% gun damage' },
  { id: 'defense', name: 'DEFENSE BOOST', color: 0x3aa0ff, cssColor: '#3aa0ff', weight: 0.3, duration: 15, desc: 'take 40% less damage' },
  { id: 'health', name: 'FIELD REPAIR', color: 0x5fd75f, cssColor: '#5fd75f', weight: 0.25, duration: 0, desc: 'restore 25% HP' },
  { id: 'invisibility', name: 'CLOAK FIELD', color: 0xb05fff, cssColor: '#b05fff', weight: 0.15, duration: 12, desc: 'harder to detect' },
];
