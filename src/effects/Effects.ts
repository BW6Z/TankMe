/**
 * Effects: pooled GPU particles (two draw calls), shockwave rings,
 * dynamic lights, floating damage numbers (DOM) and camera trauma.
 */
import * as THREE from 'three';
import { softCircleTexture, smokePuffTexture, starFlashTexture } from '../render/Textures';

const SMOKE_N = 620;
const SPARK_N = 820;

interface Pool {
  points: THREE.Points;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size0: Float32Array;
  grow: Float32Array;
  grav: Float32Array;
  drag: Float32Array;
  baseA: Float32Array;
  fadePow: Float32Array;
  next: number;
  n: number;
}

const PART_VERT = `
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;
const PART_FRAG = `
  uniform sampler2D map;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(vColor, vAlpha * tex.a);
    if (gl_FragColor.a < 0.003) discard;
  }
`;

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  scaleRate: number;
}

interface FloatNum {
  el: HTMLDivElement;
  active: boolean;
  pos: THREE.Vector3;
  life: number;
}

export class Effects {
  trauma = 0;
  shakeEnabled = true;
  private scale = 1;

  private smoke: Pool;
  private spark: Pool;
  private flash: Pool;
  private rings: Ring[] = [];
  private nums: FloatNum[] = [];
  private numsLayer: HTMLElement;
  private explosionLight: THREE.PointLight;
  private muzzleLight: THREE.PointLight;
  private debris: { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number }[] = [];
  private camera: THREE.Camera | null = null;

  constructor(scene: THREE.Scene, numsLayer: HTMLElement) {
    this.numsLayer = numsLayer;
    this.smoke = this.makePool(scene, SMOKE_N, smokePuffTexture(), THREE.NormalBlending);
    this.spark = this.makePool(scene, SPARK_N, softCircleTexture(), THREE.AdditiveBlending);
    this.flash = this.makePool(scene, 40, starFlashTexture(), THREE.AdditiveBlending);

    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 1, 36),
        new THREE.MeshBasicMaterial({ color: 0xffcf9a, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, scaleRate: 10 });
    }

    this.explosionLight = new THREE.PointLight(0xffa040, 0, 60, 1.8);
    scene.add(this.explosionLight);
    this.muzzleLight = new THREE.PointLight(0xffc060, 0, 26, 2);
    scene.add(this.muzzleLight);

    for (let i = 0; i < 30; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-num';
      el.style.display = 'none';
      numsLayer.appendChild(el);
      this.nums.push({ el, active: false, pos: new THREE.Vector3(), life: 0 });
    }

    // pooled debris chunks for explosions
    const dGeo = new THREE.TetrahedronGeometry(0.14);
    const dMat = new THREE.MeshStandardMaterial({ color: 0x2c2a26, roughness: 1 });
    for (let i = 0; i < 22; i++) {
      const mesh = new THREE.Mesh(dGeo, dMat);
      mesh.visible = false;
      scene.add(mesh);
      this.debris.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
  }

  attachCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  setQualityScale(s: number): void { this.scale = s; }

  private makePool(scene: THREE.Scene, n: number, map: THREE.Texture, blending: THREE.Blending): Pool {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const alpha = new Float32Array(n);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: PART_VERT,
      fragmentShader: PART_FRAG,
      uniforms: { map: { value: map } },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    scene.add(points);
    return {
      points, pos, col, size, alpha,
      vel: new Float32Array(n * 3),
      life: new Float32Array(n),
      maxLife: new Float32Array(n),
      size0: new Float32Array(n),
      grow: new Float32Array(n),
      grav: new Float32Array(n),
      drag: new Float32Array(n),
      baseA: new Float32Array(n),
      fadePow: new Float32Array(n),
      next: 0, n,
    };
  }

  private emit(
    p: Pool, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size: number, grow: number, r: number, g: number, b: number,
    a: number, grav: number, drag: number, fadePow = 1,
  ): void {
    const i = p.next;
    p.next = (p.next + 1) % p.n;
    p.pos[i * 3] = x; p.pos[i * 3 + 1] = y; p.pos[i * 3 + 2] = z;
    p.vel[i * 3] = vx; p.vel[i * 3 + 1] = vy; p.vel[i * 3 + 2] = vz;
    p.life[i] = life; p.maxLife[i] = life;
    p.size0[i] = size; p.size[i] = size; p.grow[i] = grow;
    p.col[i * 3] = r; p.col[i * 3 + 1] = g; p.col[i * 3 + 2] = b;
    p.baseA[i] = a; p.alpha[i] = a;
    p.grav[i] = grav; p.drag[i] = drag; p.fadePow[i] = fadePow;
  }

  addTrauma(a: number): void {
    if (this.shakeEnabled) this.trauma = Math.min(1, this.trauma + a);
  }

  // ---------------- emitters ----------------

  explosion(pos: THREE.Vector3, big: boolean): void {
    const s = this.scale * (big ? 1.5 : 1);
    const cnt = (n: number) => Math.round(n * this.scale);
    // core flash (star sprite, quick)
    this.emit(this.flash, pos.x, pos.y, pos.z, 0, 0.4, 0, 0.14, (3.4 + (big ? 2 : 0)) * s, 3.2, 1, 0.86, 0.5, 1, 0, 0, 1);
    // fire burst
    for (let i = 0; i < cnt(46); i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = (6 + Math.random() * 16) * s;
      this.emit(this.spark, pos.x, pos.y, pos.z,
        Math.sin(ph) * Math.cos(th) * sp, Math.abs(Math.cos(ph)) * sp * 0.8 + 2, Math.sin(ph) * Math.sin(th) * sp,
        0.35 + Math.random() * 0.45, (0.8 + Math.random() * 1.2) * s, 1.5,
        1, 0.45 + Math.random() * 0.35, 0.1, 0.9, -3, 2.4, 1.4);
    }
    // sparks
    for (let i = 0; i < cnt(22); i++) {
      const th = Math.random() * Math.PI * 2;
      const sp = (14 + Math.random() * 26) * s;
      this.emit(this.spark, pos.x, pos.y + 0.3, pos.z,
        Math.cos(th) * sp, 4 + Math.random() * 12, Math.sin(th) * sp,
        0.5 + Math.random() * 0.6, 0.32 * s, 0,
        1, 0.85, 0.4, 1, 16, 0.6, 1);
    }
    // smoke column
    for (let i = 0; i < cnt(30); i++) {
      const th = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 3.5) * s;
      const gray = 0.12 + Math.random() * 0.22;
      this.emit(this.smoke, pos.x + (Math.random() - 0.5) * 2, pos.y + Math.random() * 1.5, pos.z + (Math.random() - 0.5) * 2,
        Math.cos(th) * sp, 2 + Math.random() * 4, Math.sin(th) * sp,
        1.8 + Math.random() * 2.2, (1.8 + Math.random() * 1.6) * s, (2.4 + Math.random() * 2) * s,
        gray, gray * 0.95, gray * 0.9, 0.55, -1.2, 1.1, 1.2);
    }
    // ground dirt
    for (let i = 0; i < cnt(16); i++) {
      const th = Math.random() * Math.PI * 2;
      const sp = (5 + Math.random() * 10) * s;
      this.emit(this.spark, pos.x, pos.y + 0.2, pos.z,
        Math.cos(th) * sp, 3 + Math.random() * 7, Math.sin(th) * sp,
        0.7 + Math.random() * 0.7, 0.5 * s, 0.8,
        0.45, 0.36, 0.24, 0.8, 14, 1.2, 1);
    }
    this.spawnDebris(pos, big ? 9 : 6, s);
    this.ring(pos, 0xffb060, big ? 16 : 11, big ? 0.55 : 0.45);
    this.explosionLight.position.copy(pos).y += 1.5;
    this.explosionLight.intensity = big ? 70 : 42;
    this.explosionLight.distance = big ? 70 : 50;
  }

  private spawnDebris(pos: THREE.Vector3, n: number, s: number): void {
    let spawned = 0;
    for (const d of this.debris) {
      if (spawned >= n) break;
      if (d.life > 0) continue;
      spawned++;
      d.life = 1.1 + Math.random() * 0.6;
      d.mesh.visible = true;
      d.mesh.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      const sp = (7 + Math.random() * 9) * s;
      d.vel.set(Math.cos(a) * sp, 5 + Math.random() * 9, Math.sin(a) * sp);
      d.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      d.mesh.scale.setScalar(0.7 + Math.random() * 1.6);
      d.mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    }
  }

  /** engine exhaust wisp — cheap, culled by distance to camera */
  exhaust(pos: THREE.Vector3, intensity: number): void {
    if (this.camera && pos.distanceToSquared((this.camera as THREE.PerspectiveCamera).position) > 70 * 70) return;
    if (Math.random() > 0.55 * this.scale) return;
    const g = 0.5 + Math.random() * 0.1;
    this.emit(this.smoke, pos.x, pos.y, pos.z,
      (Math.random() - 0.5) * 0.7, 1.1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.7,
      0.7 + Math.random() * 0.5, 0.28 + intensity * 0.12, 0.9 + intensity * 0.5,
      g, g, g, 0.3, -0.6, 1.6, 1.4);
  }

  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, big: boolean): void {
    const s = big ? 1.4 : 1;
    const n = Math.round((big ? 14 : 9) * this.scale);
    // star flash
    this.emit(this.flash, pos.x, pos.y, pos.z, 0, 0, 0, 0.09, (1.9 + (big ? 0.9 : 0)) * s, 2.4, 1, 0.88, 0.55, 1, 0, 0, 1);
    // forward jet
    this.emit(this.flash, pos.x + dir.x * 0.5, pos.y + dir.y * 0.5, pos.z + dir.z * 0.5,
      dir.x * 8, dir.y * 8, dir.z * 8, 0.06, 1.3 * s, 2.6, 1, 0.9, 0.6, 0.95, 0, 0, 1);
    for (let i = 0; i < n; i++) {
      const jx = (Math.random() - 0.5) * 0.5, jy = (Math.random() - 0.5) * 0.5, jz = (Math.random() - 0.5) * 0.5;
      const sp = (10 + Math.random() * 18) * s;
      this.emit(this.spark, pos.x, pos.y, pos.z,
        (dir.x + jx) * sp, (dir.y + jy) * sp + 1, (dir.z + jz) * sp,
        0.08 + Math.random() * 0.12, (0.9 + Math.random() * 0.9) * s, 0,
        1, 0.8, 0.35, 0.95, 2, 3, 1);
    }
    // muzzle smoke
    for (let i = 0; i < Math.round(7 * this.scale); i++) {
      const sp = (2 + Math.random() * 4) * s;
      this.emit(this.smoke, pos.x, pos.y, pos.z,
        dir.x * sp + (Math.random() - 0.5) * 2, dir.y * sp + 1 + Math.random(), dir.z * sp + (Math.random() - 0.5) * 2,
        0.9 + Math.random() * 0.8, (0.7 + Math.random() * 0.6) * s, (1.6 + Math.random()) * s,
        0.62, 0.6, 0.58, 0.4, -0.8, 1.6, 1.2);
    }
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = big ? 30 : 18;
  }

  hitFx(pos: THREE.Vector3, normal: THREE.Vector3, kind: 'dirt' | 'metal' | 'armor'): void {
    if (kind === 'dirt') {
      for (let i = 0; i < Math.round(14 * this.scale); i++) {
        const sp = 4 + Math.random() * 8;
        this.emit(this.spark, pos.x, pos.y + 0.1, pos.z,
          (Math.random() - 0.5) * sp + normal.x * sp, Math.abs(normal.y) * sp * 0.8 + 2 + Math.random() * 4, (Math.random() - 0.5) * sp + normal.z * sp,
          0.5 + Math.random() * 0.5, 0.5, 0.5,
          0.42, 0.34, 0.22, 0.75, 14, 1.1, 1);
      }
      for (let i = 0; i < Math.round(5 * this.scale); i++) {
        this.emit(this.smoke, pos.x, pos.y + 0.3, pos.z,
          (Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2,
          1 + Math.random(), 1, 1.6, 0.5, 0.45, 0.36, 0.4, -0.5, 1.5, 1.2);
      }
      return;
    }
    const sparks = kind === 'armor' ? 18 : 12;
    for (let i = 0; i < Math.round(sparks * this.scale); i++) {
      const sp = (kind === 'armor' ? 8 : 5) + Math.random() * 12;
      this.emit(this.spark, pos.x, pos.y, pos.z,
        normal.x * sp * 0.4 + (Math.random() - 0.5) * sp, normal.y * sp * 0.4 + Math.random() * sp * 0.6, normal.z * sp * 0.4 + (Math.random() - 0.5) * sp,
        0.25 + Math.random() * 0.4, 0.3, 0,
        1, 0.8 + Math.random() * 0.2, 0.35, 1, 18, 0.4, 1);
    }
    if (kind === 'armor') {
      this.emit(this.spark, pos.x, pos.y, pos.z, 0, 0, 0, 0.09, 1.8, 1, 1, 0.6, 0.25, 0.9, 0, 0, 1);
      for (let i = 0; i < Math.round(5 * this.scale); i++) {
        this.emit(this.smoke, pos.x, pos.y, pos.z,
          (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5,
          0.8 + Math.random() * 0.6, 0.8, 1.4, 0.35, 0.33, 0.31, 0.45, -0.5, 1.5, 1.2);
      }
    }
  }

  shellTrail(pos: THREE.Vector3): void {
    this.emit(this.spark, pos.x, pos.y, pos.z, 0, 0, 0, 0.16, 0.42, 0, 1, 0.75, 0.4, 0.4, 0, 0, 1);
  }

  tankSmoke(pos: THREE.Vector3, heavy: boolean): void {
    const g = heavy ? 0.08 + Math.random() * 0.08 : 0.2 + Math.random() * 0.12;
    for (let i = 0; i < (heavy ? 2 : 1); i++) {
      this.emit(this.smoke, pos.x + (Math.random() - 0.5), pos.y, pos.z + (Math.random() - 0.5),
        (Math.random() - 0.5) * 1.2, 1.6 + Math.random() * 2, (Math.random() - 0.5) * 1.2,
        1.4 + Math.random() * 1.4, heavy ? 1.1 : 0.8, heavy ? 2.2 : 1.5,
        g, g, g, heavy ? 0.6 : 0.45, -1, 1.2, 1.2);
    }
    if (heavy && Math.random() < 0.4) {
      this.emit(this.spark, pos.x, pos.y + 0.4, pos.z, (Math.random() - 0.5) * 1, 2 + Math.random() * 2, (Math.random() - 0.5) * 1,
        0.4, 0.5, 0.4, 1, 0.5, 0.15, 0.7, -2, 1, 1);
    }
  }

  trackDust(pos: THREE.Vector3, intensity: number): void {
    if (Math.random() > intensity * this.scale) return;
    const th = Math.random() * Math.PI * 2;
    this.emit(this.smoke, pos.x + Math.cos(th) * 1.4, pos.y + 0.2, pos.z + Math.sin(th) * 1.4,
      Math.cos(th) * 1.5, 0.8 + Math.random(), Math.sin(th) * 1.5,
      0.8 + Math.random() * 0.6, 0.8, 1.6,
      0.52, 0.48, 0.38, 0.3, -0.3, 2, 1.3);
  }

  powerupFx(pos: THREE.Vector3, color: number): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < Math.round(26 * this.scale); i++) {
      const th = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 6;
      this.emit(this.spark, pos.x, pos.y, pos.z,
        Math.cos(th) * sp, 3 + Math.random() * 7, Math.sin(th) * sp,
        0.5 + Math.random() * 0.5, 0.45, 0.3, c.r, c.g, c.b, 0.95, 8, 1, 1.2);
    }
    this.ring(pos, color, 8, 0.4);
  }

  respawnFx(pos: THREE.Vector3): void {
    for (let i = 0; i < Math.round(22 * this.scale); i++) {
      const th = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      this.emit(this.spark, pos.x, pos.y + 0.5, pos.z,
        Math.cos(th) * sp, 2 + Math.random() * 5, Math.sin(th) * sp,
        0.4 + Math.random() * 0.4, 0.4, 0.2, 0.6, 0.8, 1, 0.9, 6, 1, 1.2);
    }
    this.ring(pos, 0x9ac8ff, 7, 0.45);
  }

  private ring(pos: THREE.Vector3, color: number, rate: number, life: number): void {
    const r = this.rings.find((x) => x.life <= 0);
    if (!r) return;
    r.life = life; r.maxLife = life; r.scaleRate = rate;
    (r.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    r.mesh.position.set(pos.x, pos.y + 0.25, pos.z);
    r.mesh.scale.setScalar(0.5);
    r.mesh.visible = true;
  }

  // ---------------- floating damage numbers ----------------

  floatDamage(worldPos: THREE.Vector3, amount: number, kind: 'normal' | 'crit' | 'heal'): void {
    const n = this.nums.find((x) => !x.active);
    if (!n) return;
    n.active = true;
    n.life = 1.0;
    n.pos.copy(worldPos);
    n.pos.x += (Math.random() - 0.5) * 1.2;
    n.pos.y += 1.2 + Math.random() * 0.6;
    n.el.style.display = 'block';
    n.el.className = 'dmg-num' + (kind === 'crit' ? ' crit' : kind === 'heal' ? ' heal' : '');
    n.el.textContent = kind === 'heal' ? `+${Math.round(amount)}` : `${Math.round(amount)}`;
  }

  // ---------------- frame update ----------------

  update(dt: number): void {
    this.updatePool(this.smoke, dt);
    this.updatePool(this.spark, dt);
    this.updatePool(this.flash, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    this.explosionLight.intensity = Math.max(0, this.explosionLight.intensity - dt * 220);
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 260);

    // debris chunks
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      d.vel.y -= 22 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      // settle on ground
      if (d.mesh.position.y < 0.1) { d.life = Math.min(d.life, 0.25); d.mesh.position.y = 0.1; d.vel.set(0, 0, 0); d.spin.multiplyScalar(0); }
    }

    for (const r of this.rings) {
      if (r.life <= 0) { if (r.mesh.visible) r.mesh.visible = false; continue; }
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.maxLife;
      r.mesh.scale.setScalar(0.5 + t * r.scaleRate);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
    }

    // damage numbers projection
    if (!this.camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    const v = _tv;
    for (const n of this.nums) {
      if (!n.active) continue;
      n.life -= dt;
      if (n.life <= 0) { n.active = false; n.el.style.display = 'none'; continue; }
      n.pos.y += dt * 1.4;
      v.copy(n.pos).project(this.camera);
      if (v.z > 1 || v.z < -1) { n.el.style.display = 'none'; continue; }
      n.el.style.display = 'block';
      n.el.style.left = `${((v.x * 0.5 + 0.5) * w).toFixed(1)}px`;
      n.el.style.top = `${((-v.y * 0.5 + 0.5) * h).toFixed(1)}px`;
      n.el.style.opacity = String(Math.min(1, n.life * 2));
    }
  }

  private updatePool(p: Pool, dt: number): void {
    const { pos, vel, life, maxLife, size, size0, grow, alpha, baseA, grav, drag, fadePow, n } = p;
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { alpha[i] = 0; size[i] = 0; continue; }
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[i * 3] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d - grav[i] * dt; vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const t = 1 - life[i] / maxLife[i];
      size[i] = size0[i] + grow[i] * t;
      alpha[i] = baseA[i] * Math.pow(Math.max(0, 1 - t), fadePow[i]);
    }
    const g = p.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

const _tv = new THREE.Vector3();
