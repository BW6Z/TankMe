/**
 * Analytic terrain for Ironridge Crossing.
 * heightAt(x,z) is a pure function — the mesh, tanks, shells, AI and camera all
 * sample the exact same surface, so there are no heightfield-interpolation bugs.
 */
import * as THREE from 'three';
import { MAP_CONFIG, MAP_HALF } from '../config/map';

const R = MAP_CONFIG.ridge;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Pre-flattened road segments for fast distance queries */
const roadSegs: { ax: number; az: number; bx: number; bz: number }[] = [];
for (const poly of MAP_CONFIG.roads) {
  for (let i = 0; i < poly.length - 1; i++) {
    roadSegs.push({ ax: poly[i].x, az: poly[i].z, bx: poly[i + 1].x, bz: poly[i + 1].z });
  }
}

export function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const s of roadSegs) {
    const dx = s.bx - s.ax, dz = s.bz - s.az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - s.ax) * dx + (z - s.az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = s.ax + dx * t, pz = s.az + dz * t;
    const d = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** large-scale elevation (roads follow this, ignoring small detail) */
function largeHeight(x: number, z: number): number {
  return 5.5 * Math.sin(x * 0.016 + 0.8) * Math.cos(z * 0.013)
       + 1.6 * Math.sin(x * 0.035 + 2.0) * Math.sin(z * 0.031 + 1.0);
}

function detailHeight(x: number, z: number): number {
  return 1.6 * Math.sin(x * 0.035 + 2.0) * Math.sin(z * 0.031 + 1.0)
       + 1.8 * Math.sin((x + z * 0.5) * 0.021);
}

function ridgeHeight(x: number, z: number): number {
  const ridgeZ = Math.exp(-((z - R.zCenter) * (z - R.zCenter)) / (R.width * R.width));
  const valleyGap = Math.exp(-((x - R.valleyGapX) * (x - R.valleyGapX)) / (R.valleyGapWidth * R.valleyGapWidth));
  const passGap = Math.exp(-((x - R.passGapX) * (x - R.passGapX)) / (R.passGapWidth * R.passGapWidth));
  const villageFade = Math.exp(-((x - R.villageFadeX) * (x - R.villageFadeX)) / (R.villageFadeWidth * R.villageFadeWidth));
  const gapFactor = Math.max(valleyGap, passGap);
  const nwHill = 5.5 * Math.exp(-((x + 55) * (x + 55)) / 2025 - ((z - 75) * (z - 75)) / 1600);
  const seHill = 5 * Math.exp(-((x - 55) * (x - 55)) / 1600 - ((z + 75) * (z + 75)) / 1600);
  return R.height * ridgeZ * (1 - 0.92 * gapFactor) * (1 - 0.85 * villageFade) + nwHill + seHill;
}

export function heightAt(x: number, z: number): number {
  let h = largeHeight(x, z) + detailHeight(x, z) + ridgeHeight(x, z);

  // border mountains — natural map walls
  const border = Math.max(Math.abs(x), Math.abs(z));
  h += 16 * smoothstep(126, 160, border);

  // flatten deployment zones
  const spawnFlat = Math.max(
    Math.exp(-((z + 138) * (z + 138)) / 900 - (x * x) / 3600),
    Math.exp(-((z - 138) * (z - 138)) / 900 - (x * x) / 3600),
  );
  h = h * (1 - spawnFlat * 0.9) + 2.0 * spawnFlat * 0.9;

  // flatten village plateau
  const dvx = x - MAP_CONFIG.village.x, dvz = z - MAP_CONFIG.village.z;
  const vFlat = Math.exp(-(dvx * dvx + dvz * dvz) / (MAP_CONFIG.village.radius * MAP_CONFIG.village.radius));
  h = h * (1 - vFlat * 0.85) + 1.2 * vFlat * 0.85;

  // grade road corridors toward large-scale terrain
  const rd = roadDistance(x, z);
  if (rd < 9) {
    const t = (1 - smoothstep(3.5, 9, rd)) * 0.8;
    h = h * (1 - t) + (largeHeight(x, z) + ridgeHeight(x, z)) * t;
  }
  return h;
}

const _n = new THREE.Vector3();
export function terrainNormalAt(x: number, z: number): THREE.Vector3 {
  const e = 0.7;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  // normal of surface (-dh/dx, 1, -dh/dz) normalized
  const len = Math.sqrt(hx * hx + 4 * e * e + hz * hz);
  _n.set(-hx / len, (2 * e) / len, -hz / len);
  return _n;
}

export function isInsideMap(x: number, z: number, margin = 0): boolean {
  const m = MAP_HALF - margin;
  return Math.abs(x) <= m && Math.abs(z) <= m;
}
