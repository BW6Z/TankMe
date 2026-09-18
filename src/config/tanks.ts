/** Tank vehicle specifications — all gameplay numbers live here. */

export type TankClass = 'light' | 'medium' | 'heavy';

export interface GunSpec {
  damage: number;
  /** seconds between shots */
  reload: number;
  /** m/s */
  shellSpeed: number;
  /** armor penetration rating, compared against armor zone values */
  penetration: number;
  /** dispersion (radians) applied to shot direction */
  spread: number;
  /** degrees of barrel elevation/depression */
  minPitch: number;
  maxPitch: number;
}

export interface ArmorSpec {
  front: number;
  side: number;
  rear: number;
  turret: number;
}

export interface MobilitySpec {
  maxSpeed: number;
  reverseSpeed: number;
  accel: number;
  brake: number;
  hullRot: number;
  turretRot: number;
  barrelPitchSpeed: number;
}

export interface TankDims {
  hullW: number;
  hullH: number;
  hullL: number;
  trackW: number;
  turretH: number;
  gunLen: number;
}

export interface TankSpec {
  id: string;
  name: string;
  cls: TankClass;
  desc: string;
  maxHp: number;
  gun: GunSpec;
  armor: ArmorSpec;
  mobility: MobilitySpec;
  dims: TankDims;
  colors: { hull: number; dark: number; accent: number };
}

export const TANKS: Record<string, TankSpec> = {
  jackal: {
    id: 'jackal',
    name: 'JACKAL JL-3',
    cls: 'light',
    desc: 'Fast reconnaissance hunter. Outrun anything, hit the flanks, strike rears and vanish.',
    maxHp: 620,
    gun: { damage: 110, reload: 2.6, shellSpeed: 115, penetration: 50, spread: 0.012, minPitch: -6, maxPitch: 18 },
    armor: { front: 34, side: 22, rear: 14, turret: 40 },
    mobility: { maxSpeed: 15.5, reverseSpeed: 8, accel: 9, brake: 14, hullRot: 2.3, turretRot: 3.0, barrelPitchSpeed: 1.4 },
    dims: { hullW: 2.6, hullH: 1.1, hullL: 5.2, trackW: 0.62, turretH: 0.75, gunLen: 3.4 },
    colors: { hull: 0xb0a06e, dark: 0x5a5240, accent: 0xd9c17c },
  },
  vanguard: {
    id: 'vanguard',
    name: 'VANGUARD VK-7',
    cls: 'medium',
    desc: 'Balanced main battle tank. Reliable gun, solid armor and good mobility in every direction.',
    maxHp: 950,
    gun: { damage: 200, reload: 3.8, shellSpeed: 135, penetration: 78, spread: 0.008, minPitch: -6, maxPitch: 16 },
    armor: { front: 58, side: 38, rear: 22, turret: 66 },
    mobility: { maxSpeed: 12, reverseSpeed: 6.5, accel: 6.5, brake: 10, hullRot: 1.7, turretRot: 2.1, barrelPitchSpeed: 1.1 },
    dims: { hullW: 3.0, hullH: 1.25, hullL: 6.2, trackW: 0.72, turretH: 0.9, gunLen: 4.0 },
    colors: { hull: 0x71805a, dark: 0x444e38, accent: 0x93a378 },
  },
  colossus: {
    id: 'colossus',
    name: 'COLOSSUS CS-9',
    cls: 'heavy',
    desc: 'Moving fortress. Devastating gun and massive armor, but slow to move and slow to aim.',
    maxHp: 1350,
    gun: { damage: 300, reload: 5.8, shellSpeed: 150, penetration: 105, spread: 0.007, minPitch: -5, maxPitch: 14 },
    armor: { front: 90, side: 60, rear: 34, turret: 100 },
    mobility: { maxSpeed: 9, reverseSpeed: 5, accel: 4.5, brake: 8, hullRot: 1.15, turretRot: 1.35, barrelPitchSpeed: 0.8 },
    dims: { hullW: 3.5, hullH: 1.45, hullL: 7.0, trackW: 0.85, turretH: 1.05, gunLen: 4.6 },
    colors: { hull: 0x6d747c, dark: 0x41464c, accent: 0x8b959e },
  },
};

export const TANK_IDS = ['jackal', 'vanguard', 'colossus'] as const;

/** rough 0..1 ratings used by the deploy screen stat bars */
export function tankRatings(spec: TankSpec): { hp: number; firepower: number; armor: number; speed: number; turret: number } {
  const dps = spec.gun.damage / spec.gun.reload;
  return {
    hp: spec.maxHp / 1400,
    firepower: dps / 45,
    armor: spec.armor.front / 95,
    speed: spec.mobility.maxSpeed / 16,
    turret: spec.mobility.turretRot / 3.0,
  };
}
