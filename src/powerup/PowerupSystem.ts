/**
 * Supply drops: timed spawns at fixed map points, weighted power-up types,
 * lifetime expiry, drive-over pickup.
 */
import * as THREE from 'three';
import { MAP_CONFIG } from '../config/map';
import { POWERUP_CONFIG, POWERUPS } from '../config/powerups';
import type { PowerupDef, PowerupId } from '../config/powerups';
import type { Tank } from '../tank/Tank';
import { heightAt } from '../world/Terrain';
import { bus, EV } from '../core/Events';
import { crateTexture, iconTexture } from '../render/Textures';

interface Crate {
  def: PowerupDef;
  pointIdx: number;
  pos: THREE.Vector3;
  group: THREE.Group;
  life: number;
  spin: number;
}

export class PowerupSystem {
  private active: Crate[] = [];
  private occupied = new Set<number>();
  private timer: number = POWERUP_CONFIG.firstDelay;
  private group = new THREE.Group();
  private texCache = new Map<PowerupId, THREE.Texture>();
  private iconCache = new Map<PowerupId, THREE.Texture>();
  private rngState = 12345;

  constructor(
    private scene: THREE.Scene,
    private effects: { powerupFx(pos: THREE.Vector3, color: number): void },
  ) {
    scene.add(this.group);
  }

  private rng(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  private pickDef(): PowerupDef {
    const total = POWERUPS.reduce((s, d) => s + d.weight, 0);
    let r = this.rng() * total;
    for (const d of POWERUPS) {
      r -= d.weight;
      if (r <= 0) return d;
    }
    return POWERUPS[0];
  }

  update(dt: number, tanks: Tank[]): void {
    // spawn scheduler
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = POWERUP_CONFIG.spawnInterval;
      if (this.active.length < POWERUP_CONFIG.maxActive) this.spawn();
    }

    // animate & expire
    for (let i = this.active.length - 1; i >= 0; i--) {
      const c = this.active[i];
      c.life -= dt;
      c.spin += dt;
      c.group.children[0].rotation.y = c.spin * 1.4;
      c.group.children[0].position.y = 0.95 + Math.sin(c.spin * 2.2) * 0.18;
      const icon = c.group.children[2] as THREE.Sprite;
      icon.position.y = 2.9 + Math.sin(c.spin * 2.2 + 1) * 0.22;
      // blink when about to expire
      const beam = c.group.children[1] as THREE.Mesh;
      if (c.life < 5) {
        const blink = Math.sin(c.life * 7) > 0 ? 1 : 0.25;
        (beam.material as THREE.MeshBasicMaterial).opacity = 0.16 * blink;
      }
      if (c.life <= 0) {
        this.remove(i);
        continue;
      }
      // pickup
      for (const t of tanks) {
        if (!t.alive) continue;
        const dx = t.pos.x - c.pos.x, dz = t.pos.z - c.pos.z;
        if (dx * dx + dz * dz < POWERUP_CONFIG.pickupRadius * POWERUP_CONFIG.pickupRadius) {
          t.applyPowerup(c.def);
          this.remove(i);
          break;
        }
      }
    }
  }

  private spawn(): void {
    const free: number[] = [];
    for (let i = 0; i < MAP_CONFIG.powerupPoints.length; i++) {
      if (!this.occupied.has(i)) free.push(i);
    }
    if (free.length === 0) return;
    const idx = free[Math.floor(this.rng() * free.length)];
    const pt = MAP_CONFIG.powerupPoints[idx];
    const def = this.pickDef();

    const group = new THREE.Group();
    const y = heightAt(pt.x, pt.z);

    // crate
    let tex = this.texCache.get(def.id);
    if (!tex) { tex = crateTexture(def.cssColor); this.texCache.set(def.id, tex); }
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.5, 1.5),
      new THREE.MeshStandardMaterial({ map: tex, emissive: def.color, emissiveIntensity: 0.22, roughness: 0.6 }),
    );
    crate.castShadow = true;
    crate.position.y = 0.95;
    group.add(crate);

    // light beam
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 1.0, 30, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 15;
    group.add(beam);

    // floating icon
    let iconTex = this.iconCache.get(def.id);
    if (!iconTex) { iconTex = iconTexture(def.id, def.cssColor); this.iconCache.set(def.id, iconTex); }
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex, transparent: true, depthWrite: false }));
    icon.scale.set(1.5, 1.5, 1);
    icon.position.y = 2.9;
    group.add(icon);

    group.position.set(pt.x, y, pt.z);
    this.group.add(group);

    const crate0: Crate = { def, pointIdx: idx, pos: new THREE.Vector3(pt.x, y, pt.z), group, life: POWERUP_CONFIG.lifetime, spin: this.rng() * 6 };
    this.active.push(crate0);
    this.occupied.add(idx);
    this.effects.powerupFx(crate0.pos.clone().setY(y + 1), def.color);
    bus.emit(EV.powerupSpawn, { def, pos: crate0.pos });
  }

  private remove(i: number): void {
    const c = this.active[i];
    this.occupied.delete(c.pointIdx);
    this.group.remove(c.group);
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Sprite) {
        (o.material as THREE.Material).dispose();
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      }
    });
    this.active.splice(i, 1);
  }

  /** for AI & minimap */
  list(): { pos: THREE.Vector3; id: PowerupId }[] {
    return this.active.map((c) => ({ pos: c.pos, id: c.def.id }));
  }

  clear(): void {
    while (this.active.length > 0) this.remove(0);
    this.timer = POWERUP_CONFIG.firstDelay;
  }
}
