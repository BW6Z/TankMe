/**
 * Pooled projectile system. Shells fly with slight gravity, swept-segment
 * collision vs terrain / obstacles / tank OBBs, then resolve through the
 * shared armor math: ricochet → penetration roll → damage + crits/modules.
 */
import * as THREE from 'three';
import type { Tank } from '../tank/Tank';
import type { ModuleId } from '../config/combat';
import { COMBAT_CONFIG } from '../config/combat';
import type { PhysicsWorld } from '../world/Physics';
import { heightAt } from '../world/Terrain';
import { analyzeHit, isRicochet } from './ArmorMath';
import { bus, EV } from '../core/Events';

const GRAVITY = 13;
const POOL_SIZE = 64;
const MAX_LIFE = 4.5;

interface Shell {
  alive: boolean;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  origin: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  owner: Tank | null;
  damage: number;
  penetration: number;
  damageMult: number;
  trailAcc: number;
}

export class ProjectileSystem {
  readonly shells: Shell[] = [];
  private mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private scl = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private tanksProvider: () => Tank[] = () => [];

  constructor(scene: THREE.Scene, private physics: PhysicsWorld, private effects: {
    hitFx(pos: THREE.Vector3, normal: THREE.Vector3, kind: 'dirt' | 'metal' | 'armor'): void;
    shellTrail(pos: THREE.Vector3): void;
    floatDamage(worldPos: THREE.Vector3, amount: number | string, kind: 'normal' | 'crit' | 'heal' | 'blocked'): void;
    addTrauma(amount: number): void;
  }) {
    const geo = new THREE.SphereGeometry(0.13, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL_SIZE);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = POOL_SIZE;
    // hide all initially
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < POOL_SIZE; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);

    for (let i = 0; i < POOL_SIZE; i++) {
      this.shells.push({
        alive: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(), origin: new THREE.Vector3(),
        vel: new THREE.Vector3(), life: 0, owner: null, damage: 0, penetration: 0,
        damageMult: 1, trailAcc: 0,
      });
    }
  }

  setTanksProvider(fn: () => Tank[]): void {
    this.tanksProvider = fn;
  }

  spawn(owner: Tank, muzzle: THREE.Vector3, dir: THREE.Vector3, damageMult: number): void {
    const s = this.shells.find((sh) => !sh.alive);
    if (!s) return; // pool exhausted — rare, acceptable
    s.alive = true;
    s.owner = owner;
    s.pos.copy(muzzle);
    s.prev.copy(muzzle);
    s.origin.copy(muzzle);
    s.vel.copy(dir).multiplyScalar(owner.spec.gun.shellSpeed);
    s.life = 0;
    s.damage = owner.spec.gun.damage;
    s.penetration = owner.spec.gun.penetration;
    s.damageMult = damageMult;
    s.trailAcc = 0;
  }

  update(dt: number): void {
    const tanks = this.tanksProvider();
    const sub = 2;
    const h = dt / sub;
    for (const s of this.shells) {
      if (!s.alive) continue;
      s.life += dt;
      if (s.life > MAX_LIFE) { this.kill(s); continue; }

      for (let step = 0; step < sub && s.alive; step++) {
        s.prev.copy(s.pos);
        s.vel.y -= GRAVITY * h;
        s.pos.addScaledVector(s.vel, h);

        // ground
        if (s.pos.y <= heightAt(s.pos.x, s.pos.z)) {
          this.effects.hitFx(s.pos, this.up, 'dirt');
          this.kill(s);
          break;
        }
        // static obstacles
        const hit = this.physics.segmentHit(s.prev, s.pos);
        if (hit) {
          this.effects.hitFx(hit.point, hit.normal, 'metal');
          this.kill(s);
          break;
        }
        // tanks
        this.testTanks(s, tanks);
      }
      if (s.alive) {
        s.trailAcc += dt;
        if (s.trailAcc > 0.028) {
          s.trailAcc = 0;
          this.effects.shellTrail(s.pos);
        }
      }
    }
    this.syncMesh();
  }

  private testTanks(s: Shell, tanks: Tank[]): void {
    const midX = (s.prev.x + s.pos.x) / 2, midY = (s.prev.y + s.pos.y) / 2, midZ = (s.prev.z + s.pos.z) / 2;
    for (const t of tanks) {
      if (!t.alive) continue;
      if (t === s.owner && s.life < 0.12) continue;
      const dx = t.pos.x - midX, dz = t.pos.z - midZ;
      const reach = t.radius + s.vel.length() * 0.02 + 1;
      if (dx * dx + dz * dz > reach * reach) continue;
      _dir.copy(s.vel).normalize();
      // sample current + midpoint against the tank OBB
      const zone = t.hitTest(s.pos, _dir) ?? t.hitTest(_mid.set(midX, midY, midZ), _dir);
      if (zone) {
        this.resolveHit(s, t, _mid.set(midX, midY, midZ));
        return;
      }
    }
  }

  /**
   * Authoritative armor resolution:
   *   hit point → zone → impact angle → effective armor → ricochet check →
   *   penetration roll (± spread, distance falloff) → damage + crit/module.
   */
  private resolveHit(s: Shell, victim: Tank, point: THREE.Vector3): void {
    if (s.owner) s.owner.stats.hits++;
    const flightDist = s.origin.distanceTo(point);
    const dir = _dir.copy(s.vel).normalize();
    const analysis = analyzeHit(victim, point, dir, flightDist);
    const zone = analysis?.zone ?? 'side';
    bus.emit(EV.projectileHit, { shooter: s.owner, victim, zone, point: _ev.copy(point) });

    // ---- ricochet ----
    if (analysis && isRicochet(analysis)) {
      this.effects.floatDamage(point, 'RICOCHET', 'blocked');
      bus.emit(EV.armorBlocked, {
        shooter: s.owner, victim, zone, point: _ev.copy(point), reason: 'ricochet',
      });
      this.kill(s);
      return;
    }

    // ---- penetration roll ----
    const p = COMBAT_CONFIG.penetration;
    const effArmor = analysis ? analysis.effArmor : victim.armorAt(zone);
    const roll = 1 - p.rollSpread + Math.random() * p.rollSpread * 2;
    const rolledPen = s.penetration * penDistFactor(flightDist) * roll;

    if (rolledPen <= effArmor) {
      // ---- non-penetration: no HP damage, clear feedback ----
      this.effects.floatDamage(point, 'BLOCKED', 'blocked');
      bus.emit(EV.armorBlocked, {
        shooter: s.owner, victim, zone, point: _ev.copy(point), reason: 'armor',
      });
      this.kill(s);
      return;
    }

    // ---- penetration: damage with ±spread, crits & modules ----
    const d = COMBAT_CONFIG.damage;
    const crit = Math.random() < d.critChance;
    let module: ModuleId | null = null;
    let dmg = s.damage * s.damageMult * (1 - d.spread + Math.random() * d.spread * 2);
    if (crit) dmg *= d.critMult;
    if (zone === 'tracks') {
      // running gear soaks most of the shell but always wrecks the track
      dmg *= COMBAT_CONFIG.modules.track.damageFrac;
      module = 'track';
    } else if (crit && Math.random() < d.moduleChance) {
      module = zone === 'turret' || zone === 'top' ? 'gun' : Math.random() < 0.4 ? 'track' : 'engine';
    }

    const applied = victim.applyDamage(dmg, s.owner, point, crit);
    if (module) victim.damageModule(module);

    const nrm = _v1.copy(s.vel).normalize().multiplyScalar(-1);
    this.effects.hitFx(point, nrm, 'armor');

    bus.emit(EV.armorPenetrated, {
      shooter: s.owner,
      victim,
      amount: applied,
      crit,
      module,
      zone,
      point: _ev.copy(point),
      killed: !victim.alive,
    });
    if (crit) {
      bus.emit(EV.criticalHit, { shooter: s.owner, victim, module, point: _ev.copy(point) });
    }
    this.kill(s);
  }

  private kill(s: Shell): void {
    s.alive = false;
  }

  private syncMesh(): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = this.shells[i];
      if (!s.alive) {
        this.m4.makeScale(0, 0, 0);
      } else {
        this.q.setFromUnitVectors(_v1.set(0, 0, 1), _v2.copy(s.vel).normalize());
        this.scl.set(1, 1, 2.6);
        this.m4.compose(s.pos, this.q, this.scl);
      }
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const s of this.shells) s.alive = false;
    this.syncMesh();
  }
}

function penDistFactor(flightDist: number): number {
  const p = COMBAT_CONFIG.penetration;
  return Math.max(p.minDistFactor, 1 - (p.lossPer100m * flightDist) / 100);
}

const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ev = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
