/**
 * Tank entity: movement physics, independent turret, firing, armor zones,
 * damage & buffs, respawn. Visuals live in TankVisual; control comes from a
 * Controller (player or AI) writing into `input` every frame.
 */
import * as THREE from 'three';
import type { TankSpec } from '../config/tanks';
import type { TeamId } from '../config/match';
import { MATCH_CONFIG, TEAMS } from '../config/match';
import { POWERUP_CONFIG } from '../config/powerups';
import type { PowerupDef, PowerupId } from '../config/powerups';
import { TankVisual } from './TankModel';
import type { PhysicsWorld } from '../world/Physics';
import { heightAt } from '../world/Terrain';
import { bus, EV } from '../core/Events';

export type DamageZone = 'front' | 'side' | 'rear' | 'turret';

export interface TankStats {
  kills: number; deaths: number; damageDealt: number; damageTaken: number;
  shots: number; hits: number;
}

/** systems a tank interacts with (structurally satisfied by real systems) */
export interface TankDeps {
  physics: PhysicsWorld;
  spawnShell(owner: Tank, muzzle: THREE.Vector3, dir: THREE.Vector3, damageMult: number): void;
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, big: boolean): void;
  explosion(pos: THREE.Vector3, big: boolean): void;
  hitFx(pos: THREE.Vector3, normal: THREE.Vector3, kind: 'dirt' | 'metal' | 'armor'): void;
  tankSmoke(pos: THREE.Vector3, heavy: boolean): void;
  pickupFx(pos: THREE.Vector3, color: number): void;
  exhaust(pos: THREE.Vector3, intensity: number): void;
  addTrauma(amount: number): void;
  playFire(pos: THREE.Vector3, big: boolean): void;
  playExplosion(pos: THREE.Vector3, big: boolean): void;
  playHit(pos: THREE.Vector3): void;
}

export interface TankInput {
  throttle: number;   // -1..1
  steer: number;      // -1 (left) .. 1 (right)
  brake: boolean;
  aim: THREE.Vector3; // world point to aim at
  fire: boolean;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();

export class Tank {
  readonly input: TankInput = {
    throttle: 0, steer: 0, brake: false,
    aim: new THREE.Vector3(0, 0, 1), fire: false,
  };

  hp: number;
  alive = false;
  respawnTimer = 0;
  spawnProt = 0;
  killedBy = '';

  pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  vel = new THREE.Vector3(); // measured, for AI lead
  turretYaw = 0;
  barrelPitch = 0;
  reloadLeft = 0;
  recoil = 0;
  buffs = new Map<PowerupId, number>();
  stats: TankStats = { kills: 0, deaths: 0, damageDealt: 0, damageTaken: 0, shots: 0, hits: 0 };

  readonly radius: number;
  readonly visual: TankVisual;
  private prevPos = new THREE.Vector3();
  private smokeTimer = 0;
  private turretPop = 0;
  private nameHpFrac = -1;
  nameColor = 0xffffff;
  private lastYawRate = 0;
  private prevSpeed = 0;
  private pitchKick = 0;
  private rollLean = 0;
  private hitPitch = 0;
  private hitRoll = 0;
  private bobT = 0;
  private exhaustTimer = 0;

  constructor(
    readonly spec: TankSpec,
    readonly team: TeamId,
    readonly name: string,
    readonly isPlayer: boolean,
    private deps: TankDeps,
  ) {
    this.hp = spec.maxHp;
    this.radius = spec.dims.hullW / 2 + spec.dims.trackW / 2 + 0.35;
    this.visual = new TankVisual(spec, TEAMS[team].color, name);
  }

  get invisible(): boolean {
    return (this.buffs.get('invisibility') ?? 0) > 0;
  }

  get damageMult(): number {
    return this.buffs.has('damage') ? POWERUP_CONFIG.damageBoost : 1;
  }

  get damageTakenMult(): number {
    return this.buffs.has('defense') ? POWERUP_CONFIG.defenseBoost : 1;
  }

  get turretWorldPos(): THREE.Vector3 {
    return _v3.set(this.pos.x, this.pos.y + this.visual.hullTopY + this.spec.dims.turretH * 0.5, this.pos.z);
  }

  spawnAt(x: number, z: number, yaw: number): void {
    this.alive = true;
    this.hp = this.spec.maxHp;
    this.respawnTimer = 0;
    this.spawnProt = MATCH_CONFIG.spawnProtection;
    this.buffs.clear();
    this.speed = 0;
    this.reloadLeft = 0.001;
    this.recoil = 0;
    this.turretPop = 0;
    this.pos.set(x, heightAt(x, z), z);
    this.prevPos.copy(this.pos);
    this.yaw = yaw;
    this.turretYaw = yaw;
    this.barrelPitch = 0;
    this.input.throttle = 0; this.input.steer = 0; this.input.fire = false;
    this.visual.setWreck(false);
    this.visual.setCloak(null);
    this.visual.root.position.copy(this.pos);
    this.visual.root.rotation.set(0, yaw, 0);
    this.drawNameplate();
    bus.emit(EV.tankRespawn, { tank: this });
  }

  update(dt: number, tanks: Tank[]): void {
    if (!this.alive) {
      this.respawnTimer = Math.max(0, this.respawnTimer - dt);
      if (this.turretPop > 0) {
        this.turretPop = Math.max(0, this.turretPop - dt * 1.6);
        const t = 1 - this.turretPop;
        this.visual.turretPivot.position.y = this.visual.hullTopY + Math.sin(t * Math.PI) * 1.6;
        this.visual.turretPivot.rotation.z = this.turretPop * 0.5;
      }
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.24;
        this.deps.tankSmoke(_v1.copy(this.pos).add(_v2.set(0, 1.6, 0)), true);
      }
      return;
    }

    const m = this.spec.mobility;
    const inp = this.input;

    // ---- longitudinal ----
    const targetSpeed = inp.throttle >= 0 ? inp.throttle * m.maxSpeed : inp.throttle * m.reverseSpeed;
    const accel = inp.throttle === 0 || inp.brake ? m.brake : m.accel;
    if (inp.brake) {
      const drop = m.brake * 2 * dt;
      this.speed = Math.abs(this.speed) <= drop ? 0 : this.speed - Math.sign(this.speed) * drop;
    } else if (this.speed < targetSpeed) {
      this.speed = Math.min(targetSpeed, this.speed + accel * dt);
    } else {
      this.speed = Math.max(targetSpeed, this.speed - accel * dt);
    }

    // ---- steering ----
    const speedFrac = Math.min(1, Math.abs(this.speed) / m.maxSpeed);
    const pivotFactor = 1 - 0.45 * speedFrac;
    const yawRate = inp.steer * m.hullRot * pivotFactor * (this.speed < -0.1 ? -1 : 1);
    this.lastYawRate = yawRate;
    this.yaw += yawRate * dt;

    // ---- integrate ----
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;

    // slope resistance
    if (inp.throttle > 0 && this.speed > 0.5) {
      const n = this.deps.physics.normalAt(this.pos.x, this.pos.z);
      const uphill = -(n.x * fx + n.z * fz);
      if (uphill > 0) this.speed = Math.max(0, this.speed - uphill * 3.2 * dt);
    }

    // ---- collisions ----
    const pushed = this.deps.physics.resolveCircleXZ(this.pos, this.radius);
    if (pushed) {
      const into = fx * -pushed.x + fz * -pushed.z;
      if (into > 0.2) this.speed *= Math.max(0, 1 - into * 5 * dt);
    }
    // tank vs tank
    for (const other of tanks) {
      if (other === this || !other.alive) continue;
      const dx = this.pos.x - other.pos.x, dz = this.pos.z - other.pos.z;
      const d2 = dx * dx + dz * dz;
      const minD = this.radius + other.radius;
      if (d2 < minD * minD && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (minD - d) * 0.5;
        this.pos.x += (dx / d) * push;
        this.pos.z += (dz / d) * push;
      }
    }

    // ---- terrain follow ----
    this.pos.y = heightAt(this.pos.x, this.pos.z);

    // measured velocity (for AI aiming lead)
    this.vel.set(
      (this.pos.x - this.prevPos.x) / Math.max(dt, 1e-4), 0,
      (this.pos.z - this.prevPos.z) / Math.max(dt, 1e-4),
    );
    this.prevPos.copy(this.pos);

    // ---- turret ----
    const aim = inp.aim;
    const desiredYaw = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
    let dYaw = desiredYaw - this.turretYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const tRot = m.turretRot * dt;
    if (Math.abs(dYaw) <= tRot) this.turretYaw = desiredYaw;
    else this.turretYaw += Math.sign(dYaw) * tRot;

    const gunDist = Math.hypot(aim.x - this.pos.x, aim.z - this.pos.z);
    const desiredPitch = Math.atan2(aim.y - (this.pos.y + this.visual.hullTopY + 1.2), Math.max(2, gunDist));
    const minP = THREE.MathUtils.degToRad(this.spec.gun.minPitch);
    const maxP = THREE.MathUtils.degToRad(this.spec.gun.maxPitch);
    const dPitch = THREE.MathUtils.clamp(desiredPitch, minP, maxP) - this.barrelPitch;
    const pRot = m.barrelPitchSpeed * dt;
    if (Math.abs(dPitch) <= pRot) this.barrelPitch += dPitch;
    else this.barrelPitch += Math.sign(dPitch) * pRot;

    // ---- reload & fire ----
    if (this.reloadLeft > 0) this.reloadLeft -= dt;

    // refresh transforms so firing/hit-tests read current matrices
    this.updateVisual(dt);
    this.visual.root.updateMatrixWorld(true);

    // exhaust wisp (rate scales with throttle)
    this.exhaustTimer -= dt;
    if (this.exhaustTimer <= 0 && this.spec.cls !== undefined) {
      this.exhaustTimer = 0.14 + Math.random() * 0.1;
      _v1.copy(this.visual.exhaustLocal);
      this.visual.root.localToWorld(_v1);
      this.deps.exhaust(_v1, 0.5 + Math.max(0, inp.throttle) * 0.8);
    }

    if (inp.fire && this.reloadLeft <= 0) {
      this.fire();
    }
    this.recoil = Math.max(0, this.recoil - dt * 3.2);

    // ---- buffs ----
    for (const [id, left] of this.buffs) {
      const next = left - dt;
      if (next <= 0) {
        this.buffs.delete(id);
        if (id === 'invisibility') this.visual.setCloak(null);
      } else {
        this.buffs.set(id, next);
      }
    }
    if (this.invisible) {
      this.visual.setCloak(this.isPlayer ? 0.32 : POWERUP_CONFIG.invisSelfAlpha);
    }

    if (this.spawnProt > 0) this.spawnProt -= dt;

    const hpFrac = this.hp / this.spec.maxHp;
    if (hpFrac < 0.4) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = hpFrac < 0.2 ? 0.14 : 0.3;
        this.deps.tankSmoke(_v1.copy(this.pos).add(_v2.set((Math.random() - 0.5), this.visual.fullH * 0.9, (Math.random() - 0.5) * 2)), false);
      }
    }

    if (Math.abs(hpFrac - this.nameHpFrac) > 0.015) this.drawNameplate();
  }

  private updateVisual(dt: number): void {
    const v = this.visual;
    v.root.position.copy(this.pos);

    // suspension: tilt to terrain normal, smoothed
    const n = this.deps.physics.normalAt(this.pos.x, this.pos.z);
    const fwd = _v1.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const f2 = _v2.copy(fwd).addScaledVector(n, -fwd.dot(n)).normalize();
    const right = _v3.crossVectors(n, f2).normalize();
    _m1.makeBasis(right, n, f2);
    _q1.setFromRotationMatrix(_m1);
    v.root.quaternion.slerp(_q1, Math.min(1, 7 * dt));

    // weight shift: nose pitch under accel/brake, hull roll while turning
    const accel = (this.speed - this.prevSpeed) / Math.max(dt, 1e-4);
    this.prevSpeed = this.speed;
    const maxSpeed = this.spec.mobility.maxSpeed;
    const pitchTarget = THREE.MathUtils.clamp(-accel * 0.004, -0.05, 0.05);
    const rollTarget = this.lastYawRate * Math.min(1, Math.abs(this.speed) / maxSpeed) * 0.05;
    this.pitchKick += (pitchTarget - this.pitchKick) * Math.min(1, 5 * dt);
    this.rollLean += (rollTarget - this.rollLean) * Math.min(1, 4 * dt);
    // hit impulse springs decay
    this.hitPitch *= Math.pow(0.02, dt);
    this.hitRoll *= Math.pow(0.02, dt);
    v.root.rotateX(this.pitchKick + this.hitPitch);
    v.root.rotateZ(this.rollLean + this.hitRoll);

    // suspension bob while moving
    if (Math.abs(this.speed) > 0.4) {
      this.bobT += dt * (5 + Math.abs(this.speed) * 1.1);
      v.root.position.y += Math.sin(this.bobT) * 0.018 * Math.min(1, Math.abs(this.speed) / 5);
    }

    v.turretPivot.rotation.y = this.turretYaw - this.yaw;
    v.barrelPivot.rotation.x = -this.barrelPitch;

    // barrel recoil
    v.barrelMesh.position.z = -this.recoil * 0.5;

    // track scroll — tracks move opposite while pivoting
    const halfTrack = (this.spec.dims.hullW + this.spec.dims.trackW) / 2;
    const vL = this.speed - this.lastYawRate * halfTrack;
    const vR = this.speed + this.lastYawRate * halfTrack;
    this.visual.trackTexL.offset.x -= (vL * dt) / 1.35;
    this.visual.trackTexR.offset.x -= (vR * dt) / 1.35;
  }

  private fire(): void {
    const g = this.spec.gun;
    this.reloadLeft = g.reload;
    this.recoil = 1;
    this.stats.shots++;
    if (this.spawnProt > 0) this.spawnProt = 0;

    this.visual.root.updateMatrixWorld(true);
    const muzzlePos = this.visual.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(
      Math.sin(this.turretYaw) * Math.cos(this.barrelPitch),
      Math.sin(this.barrelPitch),
      Math.cos(this.turretYaw) * Math.cos(this.barrelPitch),
    );
    // dispersion
    const sp = g.spread;
    dir.x += (Math.random() - 0.5) * sp * 2;
    dir.y += (Math.random() - 0.5) * sp * 2;
    dir.z += (Math.random() - 0.5) * sp * 2;
    dir.normalize();

    this.deps.spawnShell(this, muzzlePos, dir, this.damageMult);
    this.deps.muzzleFlash(muzzlePos, dir, this.spec.cls === 'heavy');
    this.deps.playFire(muzzlePos, this.spec.cls === 'heavy');
    if (this.isPlayer) this.deps.addTrauma(0.32);
    bus.emit(EV.tankFire, { tank: this });
  }

  /** ray/point hit test against hull OBB (turret zone detected by local height) */
  hitTest(worldPoint: THREE.Vector3): DamageZone | null {
    this.visual.root.updateMatrixWorld(true);
    _m1.copy(this.visual.root.matrixWorld).invert();
    const lp = _v1.copy(worldPoint).applyMatrix4(_m1);
    const halfL = this.visual.halfL;
    const halfW = this.visual.halfW;
    if (Math.abs(lp.x) > halfW + 0.1 || Math.abs(lp.z) > halfL + 0.1) return null;
    if (lp.y < -0.4 || lp.y > this.visual.fullH + 0.4) return null;
    if (lp.y > this.visual.hullTopY - 0.02) return 'turret';
    if (lp.z > halfL * 0.55) return 'front';
    if (lp.z < -halfL * 0.55) return 'rear';
    return 'side';
  }

  armorAt(zone: DamageZone): number {
    return this.spec.armor[zone];
  }

  applyDamage(amount: number, attacker: Tank | null, point: THREE.Vector3, crit: boolean): number {
    if (!this.alive) return 0;
    if (this.spawnProt > 0) return 0;
    // visual hit reaction
    this.hitPitch += (Math.random() - 0.5) * 0.05;
    this.hitRoll += (Math.random() - 0.5) * 0.07;
    const applied = amount * this.damageTakenMult;
    this.hp = Math.max(0, this.hp - applied);
    this.stats.damageTaken += applied;
    if (attacker) attacker.stats.damageDealt += applied;
    this.drawNameplate();
    bus.emit(EV.tankDamaged, { victim: this, attacker, amount: applied, point: point.clone(), crit });
    if (this.hp <= 0) this.die(attacker);
    return applied;
  }

  heal(fraction: number): void {
    if (!this.alive) return;
    this.hp = Math.min(this.spec.maxHp, this.hp + this.spec.maxHp * fraction);
    this.drawNameplate();
  }

  applyPowerup(def: PowerupDef): void {
    if (def.id === 'health') {
      this.heal(POWERUP_CONFIG.healFraction);
    } else {
      this.buffs.set(def.id, def.duration);
      if (def.id === 'invisibility') this.visual.setCloak(this.isPlayer ? 0.32 : POWERUP_CONFIG.invisSelfAlpha);
    }
    this.deps.pickupFx(_v1.copy(this.pos).setY(this.pos.y + 1.5), def.color);
    bus.emit(EV.powerupPickup, { tank: this, def });
  }

  private die(attacker: Tank | null): void {
    this.alive = false;
    this.hp = 0;
    this.speed = 0;
    this.respawnTimer = MATCH_CONFIG.respawnTime;
    this.killedBy = attacker ? attacker.name : '';
    this.stats.deaths++;
    if (attacker) attacker.stats.kills++;
    this.turretPop = 1;
    this.visual.setWreck(true);
    this.visual.setCloak(null);
    this.visual.turretPivot.rotation.z = 0.5;
    this.deps.explosion(_v1.copy(this.pos).add(_v2.set(0, 1.4, 0)), this.spec.cls === 'heavy');
    this.deps.playExplosion(this.pos, this.spec.cls === 'heavy');
    bus.emit(EV.tankDeath, { victim: this, attacker });
  }

  private drawNameplate(): void {
    this.nameHpFrac = this.hp / this.spec.maxHp;
    this.visual.drawNameplate(this.name, this.nameColor, this.nameHpFrac);
  }
}
