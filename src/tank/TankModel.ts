/**
 * Procedural tank models — built from primitives per TankSpec dims.
 * Each tank = 6 draw-call level meshes: merged hull, merged turret, barrel,
 * 2 scrolling tracks, team accent + a canvas nameplate sprite.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TankSpec } from '../config/tanks';
import { trackTexture } from '../render/Textures';

const CLEARANCE = 0.52;

function paint(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export class TankVisual {
  readonly root = new THREE.Group();
  readonly turretPivot = new THREE.Group();
  readonly barrelPivot = new THREE.Group();
  readonly muzzle = new THREE.Object3D();

  readonly hullMat: THREE.MeshStandardMaterial;
  readonly trackMatL: THREE.MeshStandardMaterial;
  readonly trackMatR: THREE.MeshStandardMaterial;
  readonly trackTexL: THREE.CanvasTexture;
  readonly trackTexR: THREE.CanvasTexture;
  readonly accentMat: THREE.MeshStandardMaterial;
  nameSprite!: THREE.Sprite;
  private nameCanvas!: HTMLCanvasElement;
  private nameCtx!: CanvasRenderingContext2D;
  private nameTex!: THREE.CanvasTexture;

  readonly halfL: number;
  readonly halfW: number;
  readonly fullH: number;
  readonly hullTopY: number;
  readonly barrelLen: number;

  private matList: THREE.MeshStandardMaterial[] = [];
  private geoList: THREE.BufferGeometry[] = [];

  constructor(readonly spec: TankSpec, teamColor: number, name: string) {
    const d = spec.dims;
    this.halfL = d.hullL / 2 + 0.15;
    this.halfW = d.hullW / 2 + d.trackW / 2;
    this.fullH = CLEARANCE + d.hullH + d.turretH;
    this.hullTopY = CLEARANCE + d.hullH;
    this.barrelLen = d.gunLen;

    this.hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.28 });
    const trackTex = trackTexture();
    this.trackTexL = trackTex.clone();
    this.trackTexR = trackTex.clone();
    this.trackTexL.needsUpdate = true;
    this.trackTexR.needsUpdate = true;
    this.trackMatL = new THREE.MeshStandardMaterial({ map: this.trackTexL, roughness: 0.85, metalness: 0.35 });
    this.trackMatR = new THREE.MeshStandardMaterial({ map: this.trackTexR, roughness: 0.85, metalness: 0.35 });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: teamColor, emissive: teamColor, emissiveIntensity: 0.5, roughness: 0.5,
    });
    this.matList = [this.hullMat, this.trackMatL, this.trackMatR, this.accentMat];

    this.buildHull();
    this.buildTurret();
    this.buildNameplate(name, teamColor);
  }

  private buildHull(): void {
    const d = this.spec.dims;
    const hullY = CLEARANCE + d.hullH / 2;
    const parts: THREE.BufferGeometry[] = [];

    // main hull box
    parts.push(paint(new THREE.BoxGeometry(d.hullW, d.hullH, d.hullL), this.spec.colors.hull)
      .translate(0, hullY, 0));
    // sloped glacis (front, +z)
    const glacis = paint(new THREE.BoxGeometry(d.hullW * 0.98, d.hullH * 0.8, 0.65), this.spec.colors.hull);
    glacis.rotateX(0.42);
    glacis.translate(0, hullY + d.hullH * 0.28, d.hullL / 2 - 0.28);
    parts.push(glacis);
    // rear plate
    const rear = paint(new THREE.BoxGeometry(d.hullW * 0.94, d.hullH * 0.85, 0.4), this.spec.colors.hull);
    rear.rotateX(-0.25);
    rear.translate(0, hullY + d.hullH * 0.05, -d.hullL / 2 - 0.02);
    parts.push(rear);
    // engine deck detail
    parts.push(paint(new THREE.BoxGeometry(d.hullW * 0.6, 0.14, d.hullL * 0.4), this.spec.colors.dark)
      .translate(0, CLEARANCE + d.hullH + 0.05, -d.hullL * 0.22));
    // fenders over tracks
    for (const s of [-1, 1]) {
      parts.push(paint(new THREE.BoxGeometry(d.trackW + 0.22, 0.1, d.hullL + 0.45), this.spec.colors.hull)
        .translate(s * (d.hullW / 2 + d.trackW / 2), CLEARANCE + d.hullH + 0.18, 0));
      // side skirt
      parts.push(paint(new THREE.BoxGeometry(0.1, d.hullH * 0.55, d.hullL * 0.72), this.spec.colors.hull)
        .translate(s * (d.hullW / 2 + 0.04), hullY + d.hullH * 0.18, -d.hullL * 0.05));
    }
    // road wheels (dark, merged)
    const wheelR = Math.min(0.46, CLEARANCE + 0.1);
    const nW = 5;
    for (const s of [-1, 1]) {
      for (let i = 0; i < nW; i++) {
        const z = -(d.hullL / 2 - 0.85) + (i / (nW - 1)) * (d.hullL - 1.7);
        const w = paint(new THREE.CylinderGeometry(wheelR, wheelR, d.trackW * 0.92, 12), this.spec.colors.dark);
        w.rotateZ(Math.PI / 2);
        w.translate(s * (d.hullW / 2 + d.trackW / 2), wheelR + 0.05, z);
        parts.push(w);
      }
    }
    // exhaust pipes
    parts.push(paint(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 8), this.spec.colors.dark)
      .rotateX(Math.PI / 2.4)
      .translate(-d.hullW * 0.28, CLEARANCE + d.hullH + 0.25, -d.hullL / 2 - 0.1));
    // tow hooks
    parts.push(paint(new THREE.BoxGeometry(0.12, 0.16, 0.3), this.spec.colors.dark)
      .translate(d.hullW * 0.25, CLEARANCE + 0.12, d.hullL / 2 + 0.1));
    parts.push(paint(new THREE.BoxGeometry(0.12, 0.16, 0.3), this.spec.colors.dark)
      .translate(-d.hullW * 0.25, CLEARANCE + 0.12, d.hullL / 2 + 0.1));

    const merged = mergeGeometries(parts)!;
    const hullMesh = new THREE.Mesh(merged, this.hullMat);
    hullMesh.castShadow = true;
    hullMesh.receiveShadow = true;
    this.root.add(hullMesh);
    this.geoList.push(merged);

    // tracks
    const trackLen = d.hullL + 0.5;
    const trackGeo = new THREE.BoxGeometry(d.trackW, 0.92, trackLen);
    this.geoList.push(trackGeo);
    for (const [s, mat, tex] of [[-1, this.trackMatL, this.trackTexL], [1, this.trackMatR, this.trackTexR]] as const) {
      tex.repeat.set(trackLen / 1.25, 1);
      const mesh = new THREE.Mesh(trackGeo, mat);
      mesh.position.set(s * (d.hullW / 2 + d.trackW / 2), 0.48, 0);
      mesh.castShadow = true;
      this.root.add(mesh);
    }

    // team accents
    const acc: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      acc.push(new THREE.BoxGeometry(0.14, 0.26, 1.0)
        .translate(s * (d.hullW / 2 + 0.09), hullY + d.hullH * 0.1, -d.hullL * 0.18));
    }
    const accMesh = new THREE.Mesh(mergeGeometries(acc)!, this.accentMat);
    this.root.add(accMesh);
    this.geoList.push(...acc);
  }

  private buildTurret(): void {
    const d = this.spec.dims;
    const turretY = this.hullTopY;

    this.turretPivot.position.set(0, turretY, -d.hullL * 0.04);
    this.root.add(this.turretPivot);

    const parts: THREE.BufferGeometry[] = [];
    // turret body — squashed octagonal drum, elongated
    const body = paint(new THREE.CylinderGeometry(d.hullW * 0.27, d.hullW * 0.4, d.turretH, 10), this.spec.colors.hull);
    body.scale(1.08, 1, 1.5);
    body.translate(0, d.turretH / 2, 0);
    parts.push(body);
    // mantlet
    parts.push(paint(new THREE.BoxGeometry(d.hullW * 0.38, d.turretH * 0.62, 0.5), this.spec.colors.hull)
      .translate(0, d.turretH * 0.42, d.hullW * 0.5));
    // cupola
    parts.push(paint(new THREE.CylinderGeometry(0.2, 0.26, 0.22, 8), this.spec.colors.hull)
      .translate(d.hullW * 0.14, d.turretH + 0.1, -d.hullW * 0.22));
    // rear stowage bustle
    parts.push(paint(new THREE.BoxGeometry(d.hullW * 0.5, d.turretH * 0.66, 0.5), this.spec.colors.dark)
      .translate(0, d.turretH * 0.42, -d.hullW * 0.58));
    // antenna
    const ant = paint(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 4), this.spec.colors.dark);
    ant.rotateZ(0.16);
    ant.translate(-d.hullW * 0.3, d.turretH + 0.7, -d.hullW * 0.3);
    parts.push(ant);

    const merged = mergeGeometries(parts)!;
    const turretMesh = new THREE.Mesh(merged, this.hullMat);
    turretMesh.castShadow = true;
    this.turretPivot.add(turretMesh);
    this.geoList.push(merged);

    // barrel assembly (own pivot for pitch + recoil)
    this.barrelPivot.position.set(0, d.turretH * 0.42, d.hullW * 0.45);
    this.turretPivot.add(this.barrelPivot);

    const bparts: THREE.BufferGeometry[] = [];
    const barrel = paint(new THREE.CylinderGeometry(0.115, 0.145, d.gunLen, 12), this.spec.colors.hull);
    barrel.rotateX(Math.PI / 2);
    barrel.translate(0, 0, d.gunLen / 2);
    bparts.push(barrel);
    const brake = paint(new THREE.CylinderGeometry(0.175, 0.175, 0.55, 10), this.spec.colors.dark);
    brake.rotateX(Math.PI / 2);
    brake.translate(0, 0, d.gunLen - 0.35);
    bparts.push(brake);
    const bore = paint(new THREE.CylinderGeometry(0.085, 0.085, 0.12, 10), 0x0c0d0f);
    bore.rotateX(Math.PI / 2);
    bore.translate(0, 0, d.gunLen + 0.01);
    bparts.push(bore);

    const bmerged = mergeGeometries(bparts)!;
    const barrelMesh = new THREE.Mesh(bmerged, this.hullMat);
    barrelMesh.castShadow = true;
    this.barrelPivot.add(barrelMesh);
    this.geoList.push(bmerged);

    this.muzzle.position.set(0, 0, d.gunLen + 0.05);
    this.barrelPivot.add(this.muzzle);

    // turret-top accent chevron
    const accGeo = new THREE.BoxGeometry(0.55, 0.06, 0.8).translate(0, d.turretH + 0.03, -d.hullW * 0.05);
    const accMesh = new THREE.Mesh(accGeo, this.accentMat);
    this.turretPivot.add(accMesh);
    this.geoList.push(accGeo);
  }

  private buildNameplate(name: string, teamColor: number): void {
    this.nameCanvas = document.createElement('canvas');
    this.nameCanvas.width = 256; this.nameCanvas.height = 64;
    this.nameCtx = this.nameCanvas.getContext('2d')!;
    this.nameTex = new THREE.CanvasTexture(this.nameCanvas);
    this.nameTex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.nameTex, transparent: true, depthWrite: false });
    this.nameSprite = new THREE.Sprite(mat);
    this.nameSprite.scale.set(4.4, 1.1, 1);
    this.nameSprite.position.set(0, this.fullH + 0.9, 0);
    this.root.add(this.nameSprite);
    this.drawNameplate(name, teamColor, 1);
  }

  drawNameplate(name: string, teamColor: number, hpFrac: number): void {
    const ctx = this.nameCtx;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(8, 12, 16, 0.68)';
    ctx.beginPath(); ctx.roundRect(4, 2, 248, 60, 8); ctx.fill();
    const col = '#' + new THREE.Color(teamColor).getHexString();
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(4, 2, 248, 60, 8); ctx.stroke();
    ctx.fillStyle = '#e8edf0';
    ctx.font = '700 26px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 24);
    // hp bar
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(20, 42, 216, 12);
    const pct = Math.max(0, Math.min(1, hpFrac));
    ctx.fillStyle = pct > 0.55 ? '#6fca5f' : pct > 0.25 ? '#e0a030' : '#ff5d5d';
    ctx.fillRect(20, 42, 216 * pct, 12);
    this.nameTex.needsUpdate = true;
  }

  setCloak(alpha: number | null): void {
    const cloaked = alpha !== null;
    for (const m of this.matList) {
      m.transparent = cloaked;
      m.opacity = cloaked ? alpha! : 1;
      m.depthWrite = !cloaked;
      m.needsUpdate = true;
    }
    this.nameSprite.visible = !cloaked;
  }

  setWreck(on: boolean): void {
    this.hullMat.color.set(on ? 0x4a4a4a : 0xffffff);
    this.hullMat.roughness = on ? 1 : 0.72;
    this.trackMatL.color.set(on ? 0x555555 : 0xffffff);
    this.trackMatR.color.set(on ? 0x555555 : 0xffffff);
    this.accentMat.emissiveIntensity = on ? 0 : 0.5;
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.root);
    for (const g of this.geoList) g.dispose();
    for (const m of this.matList) m.dispose();
    this.nameTex.dispose();
    (this.nameSprite.material as THREE.SpriteMaterial).dispose();
  }
}
