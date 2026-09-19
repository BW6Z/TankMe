/**
 * Tank vehicle specifications — all gameplay numbers live here.
 * Eight original vehicles in four classes, each visually inspired by a
 * historical design reference (see assets/tanks and README for the mapping):
 *
 *   KESTREL  ~ M551 Sheridan   JACKAL   ~ Type 62
 *   BULWARK  ~ M4 Sherman      VANGUARD ~ M48 Patton
 *   IRONWOLF ~ Tiger I         COLOSSUS ~ Maus
 *   MAUL     ~ ISU-152         LANCE    ~ AMX 50 Foch
 *
 * Blender-built GLB assets: assets/tanks/<id>/<id>_LOD{0,1,2}.glb
 */
export type TankClass = 'light' | 'medium' | 'heavy' | 'td';

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
  /** hull roof / turret roof plating (mm) */
  top: number;
  /** running gear — absorbing hits knocks tracks out instead of full damage */
  tracks: number;
}

export type ArmorZone = keyof ArmorSpec;

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
  /** short historical design reference, documented for originality */
  reference: string;
  maxHp: number;
  gun: GunSpec;
  armor: ArmorSpec;
  mobility: MobilitySpec;
  dims: TankDims;
  colors: { hull: number; dark: number; accent: number };
}

export const TANKS: Record<string, TankSpec> = {
  kestrel: {
    id: 'kestrel',
    name: 'KESTREL KL-1',
    cls: 'light',
    desc: 'Air-droppable gun carrier with a punchy heavy-caliber launcher. Fragile but hits far above its weight.',
    reference: 'M551 Sheridan — compact hull, forward turret, large gun, 5 road wheels',
    maxHp: 640,
    gun: { damage: 130, reload: 3.4, shellSpeed: 120, penetration: 62, spread: 0.011, minPitch: -7, maxPitch: 18 },
    armor: { front: 40, side: 26, rear: 16, turret: 45, top: 14, tracks: 18 },
    mobility: { maxSpeed: 14.5, reverseSpeed: 7.5, accel: 8.5, brake: 13, hullRot: 2.1, turretRot: 2.6, barrelPitchSpeed: 1.3 },
    dims: { hullW: 2.7, hullH: 0.9, hullL: 5.8, trackW: 0.42, turretH: 0.75, gunLen: 3.9 },
    colors: { hull: 0xb0a06e, dark: 0x5a5240, accent: 0xd9c17c },
  },
  jackal: {
    id: 'jackal',
    name: 'JACKAL JL-3',
    cls: 'light',
    desc: 'Compact reconnaissance hunter. Outrun anything, snap-shot from ridgelines, vanish before the answer arrives.',
    reference: 'Type 62 — small cast turret, slim high-velocity gun, light armor, 5 road wheels',
    maxHp: 560,
    gun: { damage: 90, reload: 2.6, shellSpeed: 115, penetration: 48, spread: 0.012, minPitch: -6, maxPitch: 18 },
    armor: { front: 30, side: 20, rear: 12, turret: 36, top: 10, tracks: 14 },
    mobility: { maxSpeed: 16, reverseSpeed: 8, accel: 9.5, brake: 14, hullRot: 2.4, turretRot: 3.0, barrelPitchSpeed: 1.4 },
    dims: { hullW: 2.6, hullH: 0.85, hullL: 5.5, trackW: 0.4, turretH: 0.68, gunLen: 3.6 },
    colors: { hull: 0x71805a, dark: 0x444e38, accent: 0x93a378 },
  },
  bulwark: {
    id: 'bulwark',
    name: 'BULWARK BM-4',
    cls: 'medium',
    desc: 'Reliable wartime workhorse. Sloped rolled armor, a steady gun and the silhouette of industrial victory.',
    reference: 'M4 Sherman — tall rounded hull, cast turret, 6 road wheels, WWII design language',
    maxHp: 900,
    gun: { damage: 160, reload: 3.9, shellSpeed: 130, penetration: 70, spread: 0.009, minPitch: -6, maxPitch: 17 },
    armor: { front: 60, side: 40, rear: 25, turret: 64, top: 18, tracks: 25 },
    mobility: { maxSpeed: 11.5, reverseSpeed: 6, accel: 6, brake: 10, hullRot: 1.6, turretRot: 2.0, barrelPitchSpeed: 1.1 },
    dims: { hullW: 2.75, hullH: 0.95, hullL: 5.9, trackW: 0.44, turretH: 0.8, gunLen: 3.7 },
    colors: { hull: 0x6f7d52, dark: 0x434c33, accent: 0x90a070 },
  },
  vanguard: {
    id: 'vanguard',
    name: 'VANGUARD VK-7',
    cls: 'medium',
    desc: 'Cold War main battle tank. Long-armed, well-sloped and confident at any range.',
    reference: 'M48 Patton — elongated cast turret with bustle, commander cupola, bore extractor',
    maxHp: 980,
    gun: { damage: 200, reload: 4.2, shellSpeed: 135, penetration: 82, spread: 0.008, minPitch: -6, maxPitch: 16 },
    armor: { front: 66, side: 42, rear: 26, turret: 72, top: 20, tracks: 27 },
    mobility: { maxSpeed: 12, reverseSpeed: 6.5, accel: 6.5, brake: 10, hullRot: 1.7, turretRot: 2.1, barrelPitchSpeed: 1.1 },
    dims: { hullW: 3.0, hullH: 0.9, hullL: 6.4, trackW: 0.48, turretH: 0.85, gunLen: 4.3 },
    colors: { hull: 0x71805a, dark: 0x444e38, accent: 0x93a378 },
  },
  ironwolf: {
    id: 'ironwolf',
    name: 'IRONWOLF IH-8',
    cls: 'heavy',
    desc: 'Boxed steel legend. Thick plate, a precise long cannon and an unmistakable wartime silhouette.',
    reference: 'Tiger I — boxy welded hull and turret, long cannon with double-baffle brake, wide tracks',
    maxHp: 1250,
    gun: { damage: 260, reload: 5.8, shellSpeed: 150, penetration: 108, spread: 0.007, minPitch: -5, maxPitch: 15 },
    armor: { front: 100, side: 70, rear: 40, turret: 105, top: 28, tracks: 42 },
    mobility: { maxSpeed: 9.5, reverseSpeed: 5, accel: 4.6, brake: 8, hullRot: 1.2, turretRot: 1.4, barrelPitchSpeed: 0.85 },
    dims: { hullW: 3.15, hullH: 0.95, hullL: 6.2, trackW: 0.52, turretH: 0.85, gunLen: 4.7 },
    colors: { hull: 0x6d747c, dark: 0x41464c, accent: 0x8b959e },
  },
  colossus: {
    id: 'colossus',
    name: 'COLOSSUS CS-9',
    cls: 'heavy',
    desc: 'A rolling fortress. Almost nothing penetrates it head-on — but you will feel every meter of the approach.',
    reference: 'Maus — super-heavy hull, enormous boxy turret, massive gun, extreme mass',
    maxHp: 1600,
    gun: { damage: 300, reload: 6.8, shellSpeed: 155, penetration: 120, spread: 0.007, minPitch: -5, maxPitch: 14 },
    armor: { front: 130, side: 95, rear: 55, turret: 140, top: 36, tracks: 55 },
    mobility: { maxSpeed: 7.5, reverseSpeed: 4.2, accel: 3.8, brake: 7, hullRot: 0.95, turretRot: 1.1, barrelPitchSpeed: 0.75 },
    dims: { hullW: 3.4, hullH: 1.05, hullL: 7.0, trackW: 0.56, turretH: 1.0, gunLen: 4.6 },
    colors: { hull: 0x6d747c, dark: 0x41464c, accent: 0x8b959e },
  },
  maul: {
    id: 'maul',
    name: 'MAUL MH-5',
    cls: 'td',
    desc: 'Casemate destroyer with a siege gun. No rotating turret — turn the hull, then erase what you face.',
    reference: 'ISU-152 — fixed armored superstructure, massive gun, heavy frontal presence',
    maxHp: 1000,
    gun: { damage: 340, reload: 6.4, shellSpeed: 140, penetration: 118, spread: 0.01, minPitch: -4, maxPitch: 14 },
    armor: { front: 110, side: 60, rear: 30, turret: 75, top: 24, tracks: 38 },
    mobility: { maxSpeed: 9, reverseSpeed: 4.8, accel: 4.4, brake: 8, hullRot: 1.1, turretRot: 0.5, barrelPitchSpeed: 0.8 },
    dims: { hullW: 3.05, hullH: 0.95, hullL: 6.6, trackW: 0.5, turretH: 0.85, gunLen: 4.0 },
    colors: { hull: 0x6f7d52, dark: 0x434c33, accent: 0x90a070 },
  },
  lance: {
    id: 'lance',
    name: 'LANCE LL-6',
    cls: 'td',
    desc: 'Low-slung hunter. A very long precision gun on a fast casemate chassis — ambush made steel.',
    reference: 'AMX 50 Foch — low casemate superstructure, long gun, post-war French design',
    maxHp: 900,
    gun: { damage: 290, reload: 5.4, shellSpeed: 145, penetration: 112, spread: 0.008, minPitch: -4, maxPitch: 14 },
    armor: { front: 90, side: 50, rear: 28, turret: 62, top: 20, tracks: 32 },
    mobility: { maxSpeed: 11, reverseSpeed: 5.5, accel: 5.4, brake: 9, hullRot: 1.3, turretRot: 0.55, barrelPitchSpeed: 0.85 },
    dims: { hullW: 3.0, hullH: 0.8, hullL: 6.7, trackW: 0.48, turretH: 0.72, gunLen: 5.2 },
    colors: { hull: 0x6a7078, dark: 0x3e444b, accent: 0x87919b },
  },
};

export const TANK_IDS = ['kestrel', 'jackal', 'bulwark', 'vanguard', 'ironwolf', 'colossus', 'maul', 'lance'] as const;

/** rough 0..1 ratings used by the deploy screen stat bars */
export function tankRatings(spec: TankSpec): { hp: number; firepower: number; armor: number; speed: number; turret: number } {
  const dps = spec.gun.damage / spec.gun.reload;
  return {
    hp: spec.maxHp / 1650,
    firepower: dps / 55,
    armor: spec.armor.front / 135,
    speed: spec.mobility.maxSpeed / 16,
    turret: spec.mobility.turretRot / 3.0,
  };
}
