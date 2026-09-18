/**
 * Coarse navigation grid + A* for AI tanks.
 * Built once per map load; queries are cheap and allocation-free on hot paths.
 */
import * as THREE from 'three';
import type { PhysicsWorld } from './Physics';
import { heightAt } from './Terrain';
import { MAP_HALF } from '../config/map';

const CELL = 8;
const GRID_N = 40; // 40*8 = 320m

export class NavGrid {
  readonly cell = CELL;
  readonly n = GRID_N;
  readonly origin = -MAP_HALF;
  blocked = new Uint8Array(GRID_N * GRID_N);

  constructor(private physics: PhysicsWorld) {}

  build(): void {
    const expand = 2.8; // tank radius + margin
    for (let gz = 0; gz < GRID_N; gz++) {
      for (let gx = 0; gx < GRID_N; gx++) {
        const x = this.origin + gx * CELL + CELL / 2;
        const z = this.origin + gz * CELL + CELL / 2;
        let b = 0;
        if (Math.abs(x) > MAP_HALF - 14 || Math.abs(z) > MAP_HALF - 14) b = 1;
        else {
          const nrm = this.physics.normalAt(x, z);
          if (nrm.y < 0.7) b = 1; // too steep
          else {
            for (const ob of this.physics.obstacles) {
              if (x > ob.minX - expand && x < ob.maxX + expand && z > ob.minZ - expand && z < ob.maxZ + expand) {
                b = 1;
                break;
              }
            }
          }
        }
        this.blocked[gz * GRID_N + gx] = b;
      }
    }
  }

  cellCenter(gx: number, gz: number): { x: number; z: number } {
    return { x: this.origin + gx * CELL + CELL / 2, z: this.origin + gz * CELL + CELL / 2 };
  }

  toCell(x: number, z: number): { gx: number; gz: number } {
    return {
      gx: Math.max(0, Math.min(GRID_N - 1, Math.floor((x - this.origin) / CELL))),
      gz: Math.max(0, Math.min(GRID_N - 1, Math.floor((z - this.origin) / CELL))),
    };
  }

  isBlockedCell(gx: number, gz: number): boolean {
    if (gx < 0 || gz < 0 || gx >= GRID_N || gz >= GRID_N) return true;
    return this.blocked[gz * GRID_N + gx] === 1;
  }

  isBlockedWorld(x: number, z: number): boolean {
    const c = this.toCell(x, z);
    return this.isBlockedCell(c.gx, c.gz);
  }

  /** spiral out to the nearest walkable cell center */
  nearestWalkable(x: number, z: number): { x: number; z: number } {
    const c = this.toCell(x, z);
    if (!this.isBlockedCell(c.gx, c.gz)) return this.cellCenter(c.gx, c.gz);
    for (let r = 1; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.isBlockedCell(c.gx + dx, c.gz + dz)) return this.cellCenter(c.gx + dx, c.gz + dz);
        }
      }
    }
    return { x, z };
  }

  /** Bresenham-style line walk over the grid; true when all cells walkable. */
  losGrid(ax: number, az: number, bx: number, bz: number): boolean {
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBlockedWorld(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A* path in world coordinates. Returns [] when unreachable. */
  findPath(sx: number, sz: number, gx: number, gz: number): THREE.Vector3[] {
    const start = this.toCell(sx, sz);
    const goal = this.toCell(gx, gz);
    if (this.isBlockedCell(goal.gx, goal.gz)) {
      const nw = this.nearestWalkable(gx, gz);
      const c = this.toCell(nw.x, nw.z);
      goal.gx = c.gx; goal.gz = c.gz;
    }
    if (this.isBlockedCell(start.gx, start.gz)) {
      const nw = this.nearestWalkable(sx, sz);
      const c = this.toCell(nw.x, nw.z);
      start.gx = c.gx; start.gz = c.gz;
    }
    const N = GRID_N;
    const startIdx = start.gz * N + start.gx;
    const goalIdx = goal.gz * N + goal.gx;
    if (startIdx === goalIdx) return [new THREE.Vector3(gx, 0, gz)];

    const open: number[] = [startIdx];
    const gScore = new Float32Array(N * N).fill(Infinity);
    const fScore = new Float32Array(N * N).fill(Infinity);
    const cameFrom = new Int32Array(N * N).fill(-1);
    const closed = new Uint8Array(N * N);
    gScore[startIdx] = 0;
    const h = (idx: number) => {
      const ix = idx % N, iz = (idx / N) | 0;
      const dx = Math.abs(ix - goal.gx), dz = Math.abs(iz - goal.gz);
      return (dx + dz) + 0.414 * Math.min(dx, dz);
    };
    fScore[startIdx] = h(startIdx);

    const dirs = [1, -1, N, -N, N + 1, N - 1, -N + 1, -N - 1];
    let guard = 0;
    while (open.length > 0 && guard++ < 6000) {
      // linear scan pop-min (grid is small)
      let bi = 0, bf = fScore[open[0]];
      for (let i = 1; i < open.length; i++) {
        if (fScore[open[i]] < bf) { bf = fScore[open[i]]; bi = i; }
      }
      const cur = open.splice(bi, 1)[0];
      if (cur === goalIdx) break;
      closed[cur] = 1;
      const cx = cur % N, cz = (cur / N) | 0;
      for (let d = 0; d < 8; d++) {
        const off = dirs[d];
        const nx = cx + (d === 0 || d === 4 || d === 6 ? 1 : d === 1 || d === 5 || d === 7 ? -1 : 0);
        const nz = cz + (d >= 2 && d <= 5 ? (d === 2 || d === 4 ? 1 : -1) : 0);
        const ni = cur + off;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        if (this.blocked[ni]) continue;
        // disallow diagonal corner cutting
        if (d >= 4 && (this.blocked[cz * N + nx] || this.blocked[nz * N + cx])) continue;
        if (closed[ni]) continue;
        const step = d >= 4 ? 1.414 : 1;
        const tentative = gScore[cur] + step;
        if (tentative < gScore[ni]) {
          cameFrom[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + h(ni);
          if (!open.includes(ni)) open.push(ni);
        }
      }
    }

    if (cameFrom[goalIdx] === -1 && goalIdx !== startIdx) return [];
    // reconstruct
    const path: THREE.Vector3[] = [];
    let cur = goalIdx;
    let guard2 = 0;
    while (cur !== -1 && guard2++ < 2000) {
      const cx = cur % N, cz = (cur / N) | 0;
      const c = this.cellCenter(cx, cz);
      path.push(new THREE.Vector3(c.x, heightAt(c.x, c.z), c.z));
      if (cur === startIdx) break;
      cur = cameFrom[cur];
    }
    path.reverse();
    path[path.length - 1] = new THREE.Vector3(gx, heightAt(gx, gz), gz);
    return this.smoothPath(path);
  }

  /** drop waypoints that can be skipped with a clear grid line */
  smoothPath(path: THREE.Vector3[]): THREE.Vector3[] {
    if (path.length <= 2) return path;
    const out: THREE.Vector3[] = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      for (; j > i + 1; j--) {
        if (this.losGrid(path[i].x, path[i].z, path[j].x, path[j].z)) break;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }

  /** random walkable point in an annulus around (x,z) */
  randomPointNear(x: number, z: number, minR: number, maxR: number, rng: () => number): THREE.Vector3 {
    for (let tries = 0; tries < 12; tries++) {
      const a = rng() * Math.PI * 2;
      const r = minR + rng() * (maxR - minR);
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!this.isBlockedWorld(px, pz)) return new THREE.Vector3(px, heightAt(px, pz), pz);
    }
    return new THREE.Vector3(x, heightAt(x, z), z);
  }
}
