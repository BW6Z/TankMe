/**
 * Ironridge Crossing — original map layout.
 * World spans x,z in [-160, 160]. Team A (COBALT) deploys south, Team B (CRIMSON) north.
 *
 * Tactical structure:
 *  - A high central ridge splits the map, with TWO crossing points:
 *    the open central valley (main road) and the narrow WEST PASS.
 *  - EAST: a walled village with streets — close-quarters brawling.
 *  - WEST: rocky highland with tree cover — flank routes and sniper nests.
 *  - CENTER: open fields with scattered hard cover south & north of the ridge.
 */

export const MAP_SIZE = 320;
export const MAP_HALF = MAP_SIZE / 2;

export interface BuildingDef {
  x: number; z: number; w: number; d: number; h: number;
  style?: 'house' | 'block' | 'barn' | 'industrial' | 'ruin';
}

export interface WallDef {
  x: number; z: number; w: number; d: number; h: number;
  kind?: 'sandbag' | 'concrete';
}

export interface ScatterRegion {
  x: number; z: number; w: number; d: number;
  count: number;
  /** exclude if inside another region type */
}

export interface SpawnZoneDef {
  /** fixed spawn points, one per slot (reused round-robin) */
  points: { x: number; z: number; yaw: number }[];
}

export type Vec2 = { x: number; z: number };

export const MAP_CONFIG = {
  name: 'IRONRIDGE CROSSING',

  ridge: {
    zCenter: 0,
    width: 34,
    height: 6.5,
    valleyGapX: 0,
    valleyGapWidth: 34,
    passGapX: -92,
    passGapWidth: 20,
    villageFadeX: 100,
    villageFadeWidth: 42,
  },

  village: { x: 100, z: 0, radius: 58 },

  roads: [
    // main north-south road through the central valley
    [{ x: 0, z: -160 }, { x: 0, z: 160 }],
    // east-west roads
    [{ x: -160, z: -45 }, { x: 160, z: -45 }],
    [{ x: -160, z: 45 }, { x: 160, z: 45 }],
    // village streets
    [{ x: 76, z: -45 }, { x: 76, z: 45 }],
    [{ x: 100, z: -45 }, { x: 100, z: 45 }],
    [{ x: 124, z: -45 }, { x: 124, z: 45 }],
    [{ x: 60, z: 0 }, { x: 140, z: 0 }],
    // west approach roads
    [{ x: -160, z: 0 }, { x: -110, z: 0 }],
    [{ x: -110, z: 0 }, { x: -92, z: 0 }],
  ] as Vec2[][],

  buildings: [
    // ---- east village grid ----
    { x: 64, z: -30, w: 16, d: 18, h: 9, style: 'house' },
    { x: 64, z: 18, w: 14, d: 20, h: 7, style: 'block' },
    { x: 88, z: -20, w: 16, d: 16, h: 11, style: 'block' },
    { x: 88, z: 22, w: 18, d: 14, h: 8, style: 'house' },
    { x: 112, z: -26, w: 14, d: 20, h: 9, style: 'house' },
    { x: 112, z: 14, w: 16, d: 16, h: 12, style: 'block' },
    { x: 134, z: -8, w: 16, d: 24, h: 8, style: 'house' },
    { x: 134, z: 32, w: 18, d: 16, h: 7, style: 'barn' },
    { x: 76, z: -52, w: 18, d: 12, h: 7, style: 'barn' },
    { x: 118, z: 52, w: 20, d: 12, h: 8, style: 'block' },
    { x: 88, z: 50, w: 14, d: 12, h: 10, style: 'house' },
    { x: 150, z: 66, w: 26, d: 18, h: 10, style: 'industrial' },
    { x: 52, z: -52, w: 12, d: 10, h: 6, style: 'ruin' },
    // ---- outposts near approaches ----
    { x: 34, z: 92, w: 16, d: 12, h: 8, style: 'block' },
    { x: -30, z: -92, w: 14, d: 12, h: 8, style: 'house' },
    { x: -58, z: 96, w: 12, d: 12, h: 7, style: 'barn' },
    { x: 56, z: -98, w: 12, d: 12, h: 7, style: 'ruin' },
    { x: -108, z: -66, w: 14, d: 10, h: 7, style: 'ruin' },
    { x: -120, z: 60, w: 12, d: 12, h: 6, style: 'barn' },
  ] as BuildingDef[],

  walls: [
    // sandbag / concrete cover in the center fields
    { x: -22, z: -58, w: 12, d: 2.2, h: 2.0, kind: 'sandbag' },
    { x: 22, z: -62, w: 2.2, d: 12, h: 2.0, kind: 'sandbag' },
    { x: -26, z: 56, w: 12, d: 2.2, h: 2.0, kind: 'sandbag' },
    { x: 26, z: 60, w: 2.2, d: 12, h: 2.0, kind: 'sandbag' },
    { x: -48, z: -20, w: 2.2, d: 14, h: 2.2, kind: 'concrete' },
    { x: 48, z: 20, w: 2.2, d: 14, h: 2.2, kind: 'concrete' },
    { x: -44, z: 28, w: 14, d: 2.2, h: 2.0, kind: 'sandbag' },
    { x: 44, z: -28, w: 14, d: 2.2, h: 2.0, kind: 'sandbag' },
    { x: 0, z: -84, w: 16, d: 2.2, h: 2.4, kind: 'concrete' },
    { x: 0, z: 84, w: 16, d: 2.2, h: 2.4, kind: 'concrete' },
    { x: -14, z: -8, w: 2.2, d: 10, h: 1.8, kind: 'sandbag' },
    { x: 14, z: 8, w: 2.2, d: 10, h: 1.8, kind: 'sandbag' },
    // village extra cover
    { x: 100, z: -8, w: 10, d: 2.2, h: 2.0, kind: 'sandbag' },
    { x: 100, z: 40, w: 2.2, d: 10, h: 2.0, kind: 'sandbag' },
    // west pass cover
    { x: -80, z: -6, w: 2.2, d: 10, h: 2.0, kind: 'concrete' },
    { x: -104, z: 6, w: 2.2, d: 10, h: 2.0, kind: 'concrete' },
  ] as WallDef[],

  rocks: { regions: [
    { x: -75, z: 40, w: 90, d: 100, count: 16 },
    { x: -75, z: -50, w: 90, d: 90, count: 14 },
    { x: 20, z: 110, w: 160, d: 50, count: 8 },
    { x: 20, z: -110, w: 160, d: 50, count: 8 },
    { x: 130, z: 90, w: 50, d: 60, count: 6 },
  ] as ScatterRegion[], scaleMin: 1.6, scaleMax: 4.6 },

  trees: { regions: [
    { x: -110, z: 90, w: 80, d: 90, count: 26 },
    { x: -110, z: -90, w: 80, d: 90, count: 26 },
    { x: -40, z: 105, w: 100, d: 40, count: 12 },
    { x: -40, z: -105, w: 100, d: 40, count: 12 },
    { x: 140, z: -70, w: 40, d: 80, count: 10 },
    { x: 140, z: 70, w: 40, d: 80, count: 10 },
  ] as ScatterRegion[] },

  spawns: [
    {
      points: [
        { x: -26, z: -136, yaw: 0 }, { x: 0, z: -140, yaw: 0 }, { x: 26, z: -136, yaw: 0 },
        { x: -52, z: -128, yaw: 0 }, { x: 52, z: -128, yaw: 0 },
        { x: -14, z: -124, yaw: 0 }, { x: 14, z: -124, yaw: 0 },
        { x: -40, z: -118, yaw: 0 }, { x: 40, z: -118, yaw: 0 },
        { x: 0, z: -116, yaw: 0 }, { x: -66, z: -136, yaw: 0 }, { x: 66, z: -136, yaw: 0 },
        { x: 0, z: -152, yaw: 0 }, { x: -30, z: -152, yaw: 0 },
      ],
    },
    {
      points: [
        { x: -26, z: 136, yaw: Math.PI }, { x: 0, z: 140, yaw: Math.PI }, { x: 26, z: 136, yaw: Math.PI },
        { x: -52, z: 128, yaw: Math.PI }, { x: 52, z: 128, yaw: Math.PI },
        { x: -14, z: 124, yaw: Math.PI }, { x: 14, z: 124, yaw: Math.PI },
        { x: -40, z: 118, yaw: Math.PI }, { x: 40, z: 118, yaw: Math.PI },
        { x: 0, z: 116, yaw: Math.PI }, { x: -66, z: 136, yaw: Math.PI }, { x: 66, z: 136, yaw: Math.PI },
        { x: 0, z: 152, yaw: Math.PI }, { x: -30, z: 152, yaw: Math.PI },
      ],
    },
  ] as SpawnZoneDef[],

  /** power-up drop points */
  powerupPoints: [
    { x: 0, z: 0 },        // central valley crossing — hotly contested
    { x: -56, z: 0 },      // ridge west
    { x: 100, z: 4 },      // village square
    { x: -92, z: -2 },     // west pass
    { x: 0, z: 62 },       // north junction
    { x: 0, z: -62 },      // south junction
    { x: 52, z: 0 },       // ridge east approach
    { x: -52, z: -40 },    // south-west field
  ] as Vec2[],

  /** AI objective points of interest */
  pois: [
    { x: 0, z: 0, weight: 1.2 },
    { x: 0, z: 50, weight: 0.8 },
    { x: 0, z: -50, weight: 0.8 },
    { x: 100, z: 0, weight: 0.9 },
    { x: -92, z: 0, weight: 0.7 },
    { x: -55, z: 0, weight: 0.6 },
    { x: 52, z: 34, weight: 0.5 },
    { x: -50, z: -34, weight: 0.5 },
  ] as { x: number; z: number; weight: number }[],
};
