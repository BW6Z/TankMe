/**
 * Tank AI: role-based state machine (seek / engage / retreat) with staggered
 * thinking, A* pathing, lead-aim gunnery, cover seeking and stuck recovery.
 */
import * as THREE from 'three';
import type { Tank } from '../tank/Tank';
import type { NavGrid } from '../world/NavGrid';
import type { PhysicsWorld } from '../world/Physics';
import type { TeamId } from '../config/match';
import { POWERUP_CONFIG } from '../config/powerups';
import type { PowerupId } from '../config/powerups';
import { MAP_CONFIG } from '../config/map';

export type AIRole = 'assault' | 'flanker' | 'sniper' | 'support' | 'defender';

const ROLE_RANGE: Record<AIRole, [number, number]> = {
  assault: [18, 40],
  flanker: [22, 45],
  sniper: [55, 90],
  support: [30, 55],
  defender: [28, 55],
};

export interface AIContext {
  physics: PhysicsWorld;
  navgrid: NavGrid;
  tanks: Tank[];
  teamObjective(team: TeamId): THREE.Vector3;
  coverPoints: THREE.Vector3[];
  powerups(): { pos: THREE.Vector3; id: PowerupId }[];
}

const VIEW_RANGE = 185;

export class AIController {
  private state: 'seek' | 'engage' | 'retreat' = 'seek';
  private target: Tank | null = null;
  private targetMemory = 0;
  private lastKnown = new THREE.Vector3();
  private losOK = false;

  private path: THREE.Vector3[] | null = null;
  private pathIdx = 0;
  private goal = new THREE.Vector3();
  private hasGoal = false;
  private repathAcc = 0;

  private thinkAcc: number;
  private thinkInterval = 0.24;

  private reaction = 0;
  private aimWander = new THREE.Vector3();
  private wanderAcc = 0;

  private stuckAcc = 0;
  private reversing = 0;

  private strafeDir: number;
  private strafeTimer = 0;
  private coverTimer = 0;
  private coverSpot: THREE.Vector3 | null = null;

  private flankSide: 1 | -1;

  constructor(
    public tank: Tank,
    private ctx: AIContext,
    public role: AIRole,
    public skill: number, // 0.7 .. 1
  ) {
    this.thinkAcc = Math.random() * this.thinkInterval;
    this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    this.flankSide = Math.random() > 0.5 ? 1 : -1;
    this.reaction = 0.5;
  }

  update(dt: number): void {
    const t = this.tank;
    if (!t.alive) { this.resetPath(); return; }

    this.thinkAcc += dt;
    if (this.thinkAcc >= this.thinkInterval) {
      this.thinkAcc -= this.thinkInterval;
      this.think(this.thinkInterval);
    }
    this.act(dt);
  }

  // ---------------- thinking (staggered) ----------------

  private think(dt: number): void {
    const t = this.tank;
    const ctx = this.ctx;

    // ---- perception ----
    let best: Tank | null = null;
    let bestScore = Infinity;
    const eye = new THREE.Vector3(t.pos.x, t.pos.y + t.visual.hullTopY + t.spec.dims.turretH, t.pos.z);
    for (const e of ctx.tanks) {
      if (!e.alive || e.team === t.team) continue;
      const d = t.pos.distanceTo(e.pos);
      const range = e.invisible ? POWERUP_CONFIG.invisDetectionRange : VIEW_RANGE;
      if (d > range) continue;
      if (d > 14) {
        const tp = new THREE.Vector3(e.pos.x, e.pos.y + e.visual.hullTopY + 0.8, e.pos.z);
        if (!ctx.physics.losClear(eye, tp)) continue;
      }
      let score = d;
      if (e.hp < e.spec.maxHp * 0.35) score -= 25; // finish wounded
      if (e === this.target) score -= 12; // target stickiness
      if (score < bestScore) { bestScore = score; best = e; }
    }

    if (best) {
      if (this.target !== best) this.reaction = 0.2 + (1 - this.skill) * 0.6;
      this.target = best;
      this.lastKnown.copy(best.pos);
      this.targetMemory = 3.5;
      this.losOK = true;
    } else {
      this.losOK = false;
      this.targetMemory -= dt;
      if (this.targetMemory <= 0) this.target = null;
    }

    // ---- state ----
    const hpFrac = t.hp / t.spec.maxHp;
    if (hpFrac < 0.3 && this.target) this.state = 'retreat';
    else if (this.target && this.losOK) this.state = 'engage';
    else this.state = 'seek';

    // ---- goal selection ----
    this.coverTimer -= dt;
    if (this.state === 'seek') {
      const g = this.chooseSeekGoal();
      this.setGoal(g);
    } else if (this.state === 'retreat') {
      const g = this.chooseRetreatGoal();
      this.setGoal(g);
    } else {
      const target = this.target!;
      const d = t.pos.distanceTo(target.pos);
      const [minR, maxR] = ROLE_RANGE[this.role];
      if (d > maxR) {
        this.setGoal(new THREE.Vector3(target.pos.x, target.pos.y, target.pos.z));
      } else if (d < minR - 5) {
        // back off from target
        const away = new THREE.Vector3().subVectors(t.pos, target.pos).normalize().multiplyScalar(18).add(t.pos);
        this.setGoal(away);
      } else {
        // hold — occasionally shift to a nearby cover spot
        if (this.coverTimer <= 0) {
          this.coverTimer = 5 + Math.random() * 5;
          const c = this.pickCover(target);
          if (c) this.setGoal(c);
          else this.resetPath();
        }
      }
    }

    // repath if goal drifted
    this.repathAcc -= dt;
    if (this.hasGoal && this.repathAcc <= 0) {
      this.repathAcc = 2.2 + Math.random();
      const last = this.path && this.path.length > 0 ? this.path[this.path.length - 1] : null;
      if (!last || last.distanceTo(this.goal) > 10) this.buildPath();
    }

    // strafe flip
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = 2.5 + Math.random() * 3;
      this.strafeDir = Math.random() > 0.5 ? 1 : -1;
    }
  }

  private chooseSeekGoal(): THREE.Vector3 {
    const t = this.tank;
    // go for helpful powerups
    for (const p of this.ctx.powerups()) {
      const d = t.pos.distanceTo(p.pos);
      if (d > 95) continue;
      if (p.id === 'health' && t.hp < t.spec.maxHp * 0.7) return p.pos.clone();
      if (p.id !== 'health' && Math.random() < 0.75) return p.pos.clone();
    }
    // hunt last known position
    if (this.target && this.targetMemory > 0) return this.lastKnown.clone();

    const obj = this.ctx.teamObjective(t.team);
    if (this.role === 'defender') {
      // stay between objective and own base
      const baseZ = t.team === 0 ? -120 : 120;
      return this.ctx.navgrid.randomPointNear(obj.x * 0.4, (obj.z + baseZ) / 2, 5, 30, Math.random);
    }
    if (this.role === 'sniper') {
      return this.ctx.navgrid.randomPointNear(obj.x, obj.z, 30, 70, Math.random);
    }
    if (this.role === 'flanker') {
      const px = this.flankSide === 1 ? 100 : -92;
      const pz = t.team === 0 ? 18 + Math.random() * 30 : -18 - Math.random() * 30;
      return new THREE.Vector3(px, 0, pz);
    }
    // assault / support head to the team objective with spread
    return this.ctx.navgrid.randomPointNear(obj.x, obj.z, 4, 26, Math.random);
  }

  private chooseRetreatGoal(): THREE.Vector3 {
    const t = this.tank;
    // prefer a health drop
    let bestP: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const p of this.ctx.powerups()) {
      if (p.id !== 'health') continue;
      const d = t.pos.distanceTo(p.pos);
      if (d < 110 && d < bestD) { bestD = d; bestP = p.pos.clone(); }
    }
    if (bestP) return bestP;
    const target = this.target;
    const c = this.pickCover(target);
    if (c) return c;
    const baseZ = t.team === 0 ? -110 : 110;
    return this.ctx.navgrid.randomPointNear(t.pos.x * 0.5, baseZ, 8, 35, Math.random);
  }

  private pickCover(from: Tank | null): THREE.Vector3 | null {
    const t = this.tank;
    let best: THREE.Vector3 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < this.ctx.coverPoints.length; i += 1) {
      const c = this.ctx.coverPoints[i];
      const d = t.pos.distanceTo(c);
      if (d < 6 || d > 55) continue;
      let score = 40 - Math.abs(d - 24);
      if (from) {
        // prefer spots on the far side of cover relative to the threat
        const toThreat = new THREE.Vector3().subVectors(from.pos, c).normalize();
        const toCover = new THREE.Vector3().subVectors(c, t.pos).normalize();
        score += toCover.dot(toThreat) * 18;
      }
      score += Math.random() * 10;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best ? best.clone() : null;
  }

  private setGoal(g: THREE.Vector3): void {
    if (!this.hasGoal || this.goal.distanceTo(g) > 12) {
      this.goal.copy(g);
      this.hasGoal = true;
      this.buildPath();
    }
  }

  private buildPath(): void {
    if (!this.hasGoal) return;
    this.path = this.ctx.navgrid.findPath(this.tank.pos.x, this.tank.pos.z, this.goal.x, this.goal.z);
    this.pathIdx = Math.min(1, Math.max(0, this.path.length - 1));
    this.repathAcc = 2.5;
  }

  private resetPath(): void {
    this.path = null;
    this.hasGoal = false;
  }

  // ---------------- acting (every frame, cheap) ----------------

  private act(dt: number): void {
    const t = this.tank;
    const inp = t.input;

    // ---- driving ----
    let desiredThrottle = 0;
    let desiredSteer = 0;

    const engaged = this.state === 'engage' && this.target && this.losOK;
    const wantAdvance = engaged && this.target!
      ? t.pos.distanceTo(this.target!.pos) > ROLE_RANGE[this.role][1]
      : false;

    if ((!engaged || wantAdvance) && this.path && this.path.length > 0) {
      // follow path (seeking or closing distance on a spotted target)
      let wp = this.path[this.pathIdx];
      while (this.pathIdx < this.path.length - 1) {
        const dx = wp.x - t.pos.x, dz = wp.z - t.pos.z;
        if (dx * dx + dz * dz < 7 * 7) {
          this.pathIdx++;
          wp = this.path[this.pathIdx];
        } else break;
      }
      const dx = wp.x - t.pos.x, dz = wp.z - t.pos.z;
      const desiredYaw = Math.atan2(dx, dz);
      const diff = angleDiff(desiredYaw, t.yaw);
      desiredSteer = THREE.MathUtils.clamp(diff * 2.2, -1, 1);
      desiredThrottle = Math.abs(diff) > 1.5 ? 0.25 : 1;
      if (this.role === 'sniper' && !wantAdvance) desiredThrottle *= 0.85;
    } else if (engaged) {
      const target = this.target!;
      const d = t.pos.distanceTo(target.pos);
      const [minR] = ROLE_RANGE[this.role];
      if (d < minR - 4) {
        // back up, keep gun on target
        desiredThrottle = -0.75;
        const away = Math.atan2(t.pos.x - target.pos.x, t.pos.z - target.pos.z);
        desiredSteer = THREE.MathUtils.clamp(angleDiff(away, t.yaw) * 1.2, -0.6, 0.6);
      } else {
        // hold position, present a moving target
        desiredThrottle = 0.14;
        desiredSteer = this.strafeDir * 0.3;
      }
    } else {
      desiredThrottle = 0;
    }

    // stuck recovery
    if (Math.abs(t.speed) < 0.5 && desiredThrottle > 0.3) this.stuckAcc += dt;
    else this.stuckAcc = 0;
    if (this.stuckAcc > 1.5) {
      this.reversing = 0.9;
      this.stuckAcc = 0;
      this.repathAcc = 0; // force repath soon
    }
    if (this.reversing > 0) {
      this.reversing -= dt;
      inp.throttle = -1;
      inp.steer = this.strafeDir;
    } else {
      inp.throttle = desiredThrottle;
      inp.steer = desiredSteer;
    }
    inp.brake = false;

    // ---- gunnery ----
    if (this.target && (this.losOK || this.targetMemory > 2)) {
      const target = this.target;
      const d = t.pos.distanceTo(target.pos);
      const lead = Math.min(1.1, d / t.spec.gun.shellSpeed) * this.skill;
      // wander grows with distance & inaccuracy
      this.wanderAcc -= dt;
      if (this.wanderAcc <= 0) {
        this.wanderAcc = 0.4 + Math.random() * 0.3;
        const err = (1.1 - this.skill) * (0.8 + d * 0.022);
        this.aimWander.set(
          (Math.random() - 0.5) * err * 2, (Math.random() - 0.5) * err * 0.6, (Math.random() - 0.5) * err * 2,
        );
      }
      inp.aim.set(
        target.pos.x + target.vel.x * lead + this.aimWander.x,
        target.pos.y + 1.35 + target.vel.y * lead + this.aimWander.y,
        target.pos.z + target.vel.z * lead + this.aimWander.z,
      );

      if (this.reaction > 0) this.reaction -= dt;

      // alignment check
      const aimYaw = Math.atan2(inp.aim.x - t.pos.x, inp.aim.z - t.pos.z);
      const aimDiff = Math.abs(angleDiff(aimYaw, t.turretYaw));
      const distFactor = THREE.MathUtils.clamp(d / 60, 0.4, 1.6);
      const aligned = aimDiff < 0.035 * distFactor + 0.012;

      inp.fire = this.reaction <= 0 && aligned && this.losOK && !this.allyInLine(target);
    } else {
      // look where you're going
      const look = 30;
      inp.aim.set(t.pos.x + Math.sin(t.yaw) * look, t.pos.y + 2, t.pos.z + Math.cos(t.yaw) * look);
      inp.fire = false;
    }
  }

  private allyInLine(target: Tank): boolean {
    const t = this.tank;
    const dir = new THREE.Vector3().subVectors(target.pos, t.pos);
    const dist = dir.length();
    dir.normalize();
    for (const a of this.ctx.tanks) {
      if (a === t || !a.alive || a.team !== t.team) continue;
      const w = new THREE.Vector3().subVectors(a.pos, t.pos);
      const proj = w.dot(dir);
      if (proj < 2 || proj > dist - 3) continue;
      const perp = Math.sqrt(Math.max(0, w.lengthSq() - proj * proj));
      if (perp < 3.6) return true;
    }
    return false;
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** weighted random POI used for the shared team objective */
export function pickTeamObjective(team: TeamId, rng: () => number = Math.random): THREE.Vector3 {
  const pois = MAP_CONFIG.pois;
  const bias = team === 0 ? 0.15 : -0.15; // slight push toward enemy half
  let total = 0;
  for (const p of pois) total += p.weight;
  let r = rng() * total;
  for (const p of pois) {
    r -= p.weight;
    if (r <= 0) return new THREE.Vector3(p.x, 0, p.z + bias * 30);
  }
  return new THREE.Vector3(pois[0].x, 0, pois[0].z);
}
