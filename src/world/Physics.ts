/**
 * Lightweight collision world: static AABB obstacles + analytic terrain.
 * Everything gameplay needs (movement resolution, line-of-sight, shell casts,
 * camera clamping) goes through here so it stays fast and consistent.
 */
import * as THREE from 'three';
import { heightAt, terrainNormalAt } from './Terrain';
import { MAP_HALF } from '../config/map';
import { MAP_SIZE } from '../config/map';

export interface Obstacle {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
  /** low walls can be shot over by arcing fire but still block movement */
  tall: boolean;
  kind: string;
}

export interface SegmentHit {
  t: number;
  point: THREE.Vector3;
  obstacle: Obstacle;
  normal: THREE.Vector3;
}

export class PhysicsWorld {
  readonly obstacles: Obstacle[] = [];

  heightAt(x: number, z: number): number {
    return heightAt(x, z);
  }

  normalAt(x: number, z: number): THREE.Vector3 {
    return terrainNormalAt(x, z);
  }

  addBox(centerX: number, centerZ: number, w: number, d: number, h: number, kind: string, tall = true): Obstacle {
    const ground = heightAt(centerX, centerZ);
    const ob: Obstacle = {
      minX: centerX - w / 2, maxX: centerX + w / 2,
      minZ: centerZ - d / 2, maxZ: centerZ + d / 2,
      minY: ground - 0.5, maxY: ground + h,
      tall, kind,
    };
    this.obstacles.push(ob);
    return ob;
  }

  /** Ray/AABB slab test against every obstacle. Returns nearest hit or null. */
  segmentHit(p0: THREE.Vector3, p1: THREE.Vector3): SegmentHit | null {
    let best: SegmentHit | null = null;
    let bestT = 1;
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    for (let i = 0; i < this.obstacles.length; i++) {
      const ob = this.obstacles[i];
      const t = raySlab(p0, dx, dy, dz, ob);
      if (t !== null && t < bestT) {
        bestT = t;
        const nx = p0.x + dx * t, ny = p0.y + dy * t, nz = p0.z + dz * t;
        best = {
          t, obstacle: ob,
          point: new THREE.Vector3(nx, ny, nz),
          normal: slabNormal(ob, nx, ny, nz),
        };
      }
    }
    return best;
  }

  /** true when nothing static blocks the segment */
  losClear(p0: THREE.Vector3, p1: THREE.Vector3): boolean {
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    for (let i = 0; i < this.obstacles.length; i++) {
      if (raySlab(p0, dx, dy, dz, this.obstacles[i]) !== null) return false;
    }
    return true;
  }

  /** Push a circle (tank footprint) out of obstacles in XZ. Returns collision normal or null. */
  resolveCircleXZ(pos: THREE.Vector3, radius: number): THREE.Vector3 | null {
    let pushed: THREE.Vector3 | null = null;
    for (let i = 0; i < this.obstacles.length; i++) {
      const ob = this.obstacles[i];
      // closest point on box (XZ)
      const cx = Math.max(ob.minX, Math.min(pos.x, ob.maxX));
      const cz = Math.max(ob.minZ, Math.min(pos.z, ob.maxZ));
      let dx = pos.x - cx, dz = pos.z - cz;
      let d2 = dx * dx + dz * dz;
      if (d2 > radius * radius) continue;

      if (d2 < 1e-6) {
        // center inside the box — push out along smallest penetration axis
        const pLeft = pos.x - ob.minX, pRight = ob.maxX - pos.x;
        const pBack = pos.z - ob.minZ, pFront = ob.maxZ - pos.z;
        const m = Math.min(pLeft, pRight, pBack, pFront);
        if (m === pLeft) { pos.x = ob.minX - radius; pushed = new THREE.Vector3(-1, 0, 0); }
        else if (m === pRight) { pos.x = ob.maxX + radius; pushed = new THREE.Vector3(1, 0, 0); }
        else if (m === pBack) { pos.z = ob.minZ - radius; pushed = new THREE.Vector3(0, 0, -1); }
        else { pos.z = ob.maxZ + radius; pushed = new THREE.Vector3(0, 0, 1); }
      } else {
        const d = Math.sqrt(d2);
        const push = (radius - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
        pushed = new THREE.Vector3(dx / d, 0, dz / d);
      }
    }
    // map bounds
    const lim = MAP_HALF - 8;
    if (pos.x < -lim) { pos.x = -lim; pushed = new THREE.Vector3(1, 0, 0); }
    if (pos.x > lim) { pos.x = lim; pushed = new THREE.Vector3(-1, 0, 0); }
    if (pos.z < -lim) { pos.z = -lim; pushed = new THREE.Vector3(0, 0, 1); }
    if (pos.z > lim) { pos.z = lim; pushed = new THREE.Vector3(0, 0, -1); }
    return pushed;
  }

  /**
   * March a ray against the terrain. Returns hit distance or -1.
   * Coarse steps with one bisection refine — plenty accurate for aiming/camera.
   */
  groundRay(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): number {
    let t = 0;
    const step = 2.0;
    let prevDiff = origin.y - heightAt(origin.x, origin.z);
    if (prevDiff <= 0) return 0;
    while (t < maxDist) {
      t += step;
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (Math.abs(x) > MAP_SIZE * 0.75 || Math.abs(z) > MAP_SIZE * 0.75) return -1;
      const diff = y - heightAt(x, z);
      if (diff <= 0) {
        // bisect between t-step and t
        let lo = t - step, hi = t;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2;
          const my = origin.y + dir.y * mid;
          const mDiff = my - heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (mDiff <= 0) hi = mid; else lo = mid;
        }
        return hi;
      }
      prevDiff = diff;
    }
    return -1;
  }
}

function raySlab(p0: THREE.Vector3, dx: number, dy: number, dz: number, ob: Obstacle): number | null {
  let tmin = 0, tmax = 1;
  // X
  if (Math.abs(dx) < 1e-9) { if (p0.x < ob.minX || p0.x > ob.maxX) return null; }
  else {
    let t1 = (ob.minX - p0.x) / dx, t2 = (ob.maxX - p0.x) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Y
  if (Math.abs(dy) < 1e-9) { if (p0.y < ob.minY || p0.y > ob.maxY) return null; }
  else {
    let t1 = (ob.minY - p0.y) / dy, t2 = (ob.maxY - p0.y) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Z
  if (Math.abs(dz) < 1e-9) { if (p0.z < ob.minZ || p0.z > ob.maxZ) return null; }
  else {
    let t1 = (ob.minZ - p0.z) / dz, t2 = (ob.maxZ - p0.z) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

function slabNormal(ob: Obstacle, x: number, y: number, z: number): THREE.Vector3 {
  // pick the face whose plane is closest to the hit point
  const dl = Math.abs(x - ob.minX), dr = Math.abs(x - ob.maxX);
  const db = Math.abs(z - ob.minZ), df = Math.abs(z - ob.maxZ);
  const dt = Math.abs(y - ob.maxY);
  const m = Math.min(dl, dr, db, df, dt);
  if (m === dt) return new THREE.Vector3(0, 1, 0);
  if (m === dl) return new THREE.Vector3(-1, 0, 0);
  if (m === dr) return new THREE.Vector3(1, 0, 0);
  if (m === db) return new THREE.Vector3(0, 0, -1);
  return new THREE.Vector3(0, 0, 1);
}
