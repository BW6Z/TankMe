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
import { iconTexture } from '../render/Textures';

interface Crate {
  def: PowerupDef;
  pointIdx: number;
  pos: THREE.Vector3;
  group: THREE.Group;
  life: number;
  spin: number;
  core: THREE.Mesh;
  halo: THREE.Mesh;
  pulse: THREE.Mesh;
}

export class PowerupSystem {
  private active: Crate[] = [];
  private occupied = new Set<number>();
  private timer: number = POWERUP_CONFIG.firstDelay;
  private group = new THREE.Group();
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
      c.group.children[0].rotation.y = c.spin * 0.9;
      const crateGroup = c.group.children[0] as THREE.Group;
      crateGroup.position.y = Math.sin(c.spin * 2.1) * 0.16;
      c.core.rotation.y = c.spin * 2.2;
      c.core.rotation.x = c.spin * 1.4;
      const pulse = 0.75 + Math.sin(c.spin * 4) * 0.25;
      (c.halo.material as THREE.MeshBasicMaterial).opacity = 0.55 + pulse * 0.3;
      c.halo.rotation.z = c.spin * 0.8;
      const pr = 1 + ((c.spin * 0.7) % 1) * 1.6;
      c.pulse.scale.setScalar(pr);
      (c.pulse.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - ((c.spin * 0.7) % 1));
      const icon = c.group.children[3] as THREE.Sprite;
      icon.position.y = 2.75 + Math.sin(c.spin * 2.1 + 1) * 0.2;
      // blink when about to expire
      const beam = c.group.children[2] as THREE.Mesh;
      if (c.life < 5) {
        const blink = Math.sin(c.life * 7) > 0 ? 1 : 0.25;
        (beam.material as THREE.MeshBasicMaterial).opacity = 0.13 * blink;
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

    // --- supply crate: beveled box + glowing core + halo ring ---
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.55, metalness: 0.5 });
    const frameMat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.3 });
    const coreMat = new THREE.MeshStandardMaterial({ color: 0x101410, emissive: def.color, emissiveIntensity: 2.6, roughness: 0.3 });
    const crate = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 1.15), crateMat);
    body.position.y = 0.78;
    crate.add(body);
    // angled corner plates
    for (const [dx, dz, ry] of [[1, 1, Math.PI / 4], [-1, 1, -Math.PI / 4], [1, -1, -Math.PI / 4], [-1, -1, Math.PI / 4]] as const) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 1.06, 0.1), frameMat);
      plate.position.set(dx * 0.44, 0.78, dz * 0.44);
      plate.rotation.y = ry;
      crate.add(plate);
    }
    // top frame
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.09, 1.2), frameMat);
    top.position.y = 1.28;
    crate.add(top);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.09, 1.2), frameMat);
    bottom.position.y = 0.3;
    crate.add(bottom);
    // glowing core
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), coreMat);
    core.position.y = 0.79;
    crate.add(core);
    group.add(crate);

    // halo ring + ground pulse ring
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.045, 8, 32),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.79;
    group.add(halo);
    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.05, 32),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    pulse.rotation.x = -Math.PI / 2;
    pulse.position.y = 0.12;
    group.add(pulse);

    // light shaft
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.9, 30, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = 15;
    group.add(beam);

    // floating icon
    let iconTex = this.iconCache.get(def.id);
    if (!iconTex) { iconTex = iconTexture(def.id, def.cssColor); this.iconCache.set(def.id, iconTex); }
    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTex, transparent: true, depthWrite: false }));
    icon.scale.set(1.35, 1.35, 1);
    icon.position.y = 2.75;
    group.add(icon);

    group.position.set(pt.x, y, pt.z);
    this.group.add(group);

    const crate0: Crate = {
      def, pointIdx: idx, pos: new THREE.Vector3(pt.x, y, pt.z), group,
      life: POWERUP_CONFIG.lifetime, spin: this.rng() * 6, core, halo, pulse,
    };
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
