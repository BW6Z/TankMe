/**
 * Pooled projectile system. Shells fly with slight gravity, swept-segment
 * collision vs terrain / obstacles / tank OBBs, and resolve armor-zone damage.
 */
import * as THREE from 'three';
import type { Tank } from '../tank/Tank';
import type { PhysicsWorld } from '../world/Physics';
import { heightAt } from '../world/Terrain';
import { bus, EV } from '../core/Events';

const GRAVITY = 13;
const POOL_SIZE = 64;
const MAX_LIFE = 4.5;

interface Shell {
  alive: boolean;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
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
    floatDamage(worldPos: THREE.Vector3, amount: number, kind: 'normal' | 'crit' | 'heal'): void;
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
        alive: false, pos: new THREE.Vector3(), prev: new THREE.Vector3(),
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
      // sample current + midpoint against the tank OBB
      const zone = t.hitTest(s.pos) ?? t.hitTest(_mid.set(midX, midY, midZ));
      if (zone) {
        this.resolveHit(s, t, zone, _mid.set(midX, midY, midZ));
        return;
      }
    }
  }

  private resolveHit(s: Shell, victim: Tank, zone: string, point: THREE.Vector3): void {
    if (s.owner) s.owner.stats.hits++;
    const armor = victim.armorAt(zone as any);
    const penFactor = Math.max(0.22, Math.min(1.1, s.penetration / Math.max(1, armor)));
    const crit = penFactor >= 1 && Math.random() < 0.18;
    const base = s.damage * s.damageMult * penFactor * (crit ? 1.4 : 1);
    const applied = victim.applyDamage(base, s.owner, point, crit);

    const nrm = _v1.copy(s.vel).normalize().multiplyScalar(-1);
    this.effects.hitFx(point, nrm, 'armor');

    bus.emit(EV.combatHit, {
      shooter: s.owner,
      victim,
      amount: applied,
      crit,
      zone,
      point: _v2.copy(point),
      killed: !victim.alive,
    });
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

const _mid = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
