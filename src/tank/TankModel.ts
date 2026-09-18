/**
 * Procedural tank models — three distinct class silhouettes built from
 * detailed primitive assemblies with PBR materials (detail normal maps,
 * roughness variation), contact shadows and battle-worn vertex tinting.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TankSpec } from '../config/tanks';
import { trackTexture, detailNormalTexture, roughnessNoiseTexture, blobShadowTexture } from '../render/Textures';

const CLEARANCE = 0.55;

function paint(geo: THREE.BufferGeometry, color: number, jitter = 0.06, seed = 1): THREE.BufferGeometry {
  const base = new THREE.Color(color);
  const rng = (i: number) => {
    const v = Math.sin((i + 1) * 12.9898 * seed) * 43758.5453;
    return v - Math.floor(v);
  };
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (rng(i) - 0.5) * 2 * jitter;
    arr[i * 3] = base.r * j;
    arr[i * 3 + 1] = base.g * j;
    arr[i * 3 + 2] = base.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function bx(w: number, h: number, d: number, x: number, y: number, z: number, color: number,
  rx = 0, ry = 0, rz = 0, jitter = 0.06, seed = 1): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paint(g, color, jitter, seed);
}

function cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: number,
  rx = 0, ry = 0, rz = 0, sx = 1, sz = 1, jitter = 0.06, seed = 1): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.scale(sx, 1, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paint(g, color, jitter, seed);
}

const GUNMETAL = 0x23262a;
const RUBBER = 0x17181a;
const DARKSTEEL = 0x3a3f43;

export class TankVisual {
  readonly root = new THREE.Group();
  readonly turretPivot = new THREE.Group();
  readonly barrelPivot = new THREE.Group();
  readonly barrelMesh!: THREE.Mesh;
  readonly muzzle = new THREE.Object3D();

  readonly hullMat: THREE.MeshStandardMaterial;
  readonly trackMatL: THREE.MeshStandardMaterial;
  readonly trackMatR: THREE.MeshStandardMaterial;
  readonly trackTexL: THREE.CanvasTexture;
  readonly trackTexR: THREE.CanvasTexture;
  readonly accentMat: THREE.MeshStandardMaterial;
  readonly blobShadow: THREE.Mesh;
  nameSprite!: THREE.Sprite;
  private nameCanvas!: HTMLCanvasElement;
  private nameCtx!: CanvasRenderingContext2D;
  private nameTex!: THREE.CanvasTexture;
  private showNameplate: boolean;

  readonly halfL: number;
  readonly halfW: number;
  readonly fullH: number;
  readonly hullTopY: number;
  readonly barrelLen: number;
  exhaustLocal!: THREE.Vector3;

  private matList: THREE.Material[] = [];
  private geoList: THREE.BufferGeometry[] = [];
  private accentHex: number;

  constructor(readonly spec: TankSpec, teamColor: number, name: string, opts?: { nameplate?: boolean }) {
    this.showNameplate = opts?.nameplate ?? true;
    this.accentHex = teamColor;
    const d = spec.dims;
    this.halfL = d.hullL / 2 + 0.15;
    this.halfW = d.hullW / 2 + d.trackW / 2;
    this.fullH = CLEARANCE + d.hullH + d.turretH;
    this.hullTopY = CLEARANCE + d.hullH;
    this.barrelLen = d.gunLen;

    const detail = detailNormalTexture();
    const rough = roughnessNoiseTexture();
    this.hullMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.82, metalness: 0.18,
      normalMap: detail, roughnessMap: rough,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 0.7,
    });
    const trackTex = trackTexture();
    this.trackTexL = trackTex.clone();
    this.trackTexR = trackTex.clone();
    this.trackTexL.needsUpdate = true;
    this.trackTexR.needsUpdate = true;
    this.trackMatL = new THREE.MeshStandardMaterial({ map: this.trackTexL, roughness: 0.9, metalness: 0.3, envMapIntensity: 0.5 });
    this.trackMatR = new THREE.MeshStandardMaterial({ map: this.trackTexR, roughness: 0.9, metalness: 0.3, envMapIntensity: 0.5 });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: teamColor, emissive: teamColor, emissiveIntensity: 0.42, roughness: 0.5, metalness: 0.2,
    });
    this.matList = [this.hullMat, this.trackMatL, this.trackMatR, this.accentMat];

    // contact shadow — grounds the vehicle even at low quality
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 3.1, this.halfL * 2.15),
      new THREE.MeshBasicMaterial({
        map: blobShadowTexture(), transparent: true, opacity: 0.42,
        depthWrite: false,
      }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.05;
    blob.renderOrder = 1;
    this.blobShadow = blob;
    this.root.add(blob);

    const hull = this.hullColor();
    this.buildRunningGear(hull);
    this.buildHull(hull);
    this.buildTurret(hull);
    if (this.showNameplate) this.buildNameplate(name, teamColor);
    else this.nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
  }

  private hullColor(): number { return this.spec.colors.hull; }

  // ------------------------------------------------------------------
  // running gear: wheels, suspension arms, tracks
  // ------------------------------------------------------------------

  private buildRunningGear(hull: number): void {
    const d = this.spec.dims;
    const cls = this.spec.cls;
    const wheelR = cls === 'light' ? 0.34 : cls === 'medium' ? 0.4 : 0.42;
    const nWheels = cls === 'light' ? 5 : cls === 'medium' ? 6 : 7;
    const span = d.hullL - 1.6;
    const wheelParts: THREE.BufferGeometry[] = [];
    const armParts: THREE.BufferGeometry[] = [];

    for (const s of [-1, 1]) {
      for (let i = 0; i < nWheels; i++) {
        const t = i / (nWheels - 1);
        const z = -span / 2 + t * span;
        // drive/idler slightly raised at the ends
        const edge = Math.min(t, 1 - t);
        const lift = edge <= 0.001 ? wheelR * 0.22 : 0;
        const y = wheelR + 0.05 + lift;
        // tire
        wheelParts.push(paint(new THREE.CylinderGeometry(wheelR, wheelR, d.trackW * 0.86, 14), RUBBER, 0.04, i + 1)
          .rotateZ(Math.PI / 2)
          .translate(s * (d.hullW / 2 + d.trackW / 2), y, z));
        // hub disc
        wheelParts.push(paint(new THREE.CylinderGeometry(wheelR * 0.55, wheelR * 0.55, d.trackW * 0.9, 10), DARKSTEEL, 0.05, i + 2)
          .rotateZ(Math.PI / 2)
          .translate(s * (d.hullW / 2 + d.trackW / 2), y, z));
        // hub bolt ring look: small torus-ish disc
        wheelParts.push(paint(new THREE.CylinderGeometry(wheelR * 0.2, wheelR * 0.2, d.trackW * 0.95, 8), 0x2a2d30, 0.04, i + 3)
          .rotateZ(Math.PI / 2)
          .translate(s * (d.hullW / 2 + d.trackW / 2), y, z));
        // suspension arm
        armParts.push(bx(0.14, wheelR * 0.9, 0.28, s * (d.hullW / 2 + 0.05), CLEARANCE - 0.1, z, 0x2c2f33, 0, 0, s * 0.28, 0.04, i + 4));
      }
    }
    const wheelMesh = new THREE.Mesh(mergeGeometries(wheelParts)!, this.hullMat);
    wheelMesh.castShadow = true;
    this.root.add(wheelMesh);
    const armMesh = new THREE.Mesh(mergeGeometries(armParts)!, this.hullMat);
    this.root.add(armMesh);
    this.geoList.push(...wheelParts, ...armParts);

    // tracks
    const trackLen = d.hullL + 0.55;
    const trackGeo = new THREE.BoxGeometry(d.trackW, 0.95, trackLen);
    this.geoList.push(trackGeo);
    const entries: [number, THREE.MeshStandardMaterial, THREE.CanvasTexture][] = [
      [-1, this.trackMatL, this.trackTexL], [1, this.trackMatR, this.trackTexR],
    ];
    for (const [s, mat, tex] of entries) {
      tex.repeat.set(trackLen / 1.35, 1);
      const mesh = new THREE.Mesh(trackGeo, mat);
      mesh.position.set(s * (d.hullW / 2 + d.trackW / 2), 0.5, 0);
      mesh.castShadow = true;
      this.root.add(mesh);
    }
  }

  // ------------------------------------------------------------------
  // hull per class
  // ------------------------------------------------------------------

  private buildHull(hull: number): void {
    const d = this.spec.dims;
    const cls = this.spec.cls;
    const y0 = CLEARANCE;
    const hullY = y0 + d.hullH / 2;
    const top = y0 + d.hullH;
    const parts: THREE.BufferGeometry[] = [];

    // main hull box
    parts.push(bx(d.hullW, d.hullH, d.hullL, 0, hullY, 0, hull, 0, 0, 0, 0.05, 1));
    // sloped glacis (two-step for heavier classes)
    const glacisDrop = cls === 'light' ? 0.5 : cls === 'medium' ? 0.42 : 0.3;
    const gl = bx(d.hullW * 0.99, d.hullH * 0.72, 0.72, hull, 0, 0, 0, 0.5, 1);
    gl.rotateX(glacisDrop);
    gl.translate(0, hullY + d.hullH * 0.24, d.hullL / 2 - 0.3);
    parts.push(gl);
    if (cls === 'heavy') {
      // appliqué armor wedge on the glacis
      const ap = bx(d.hullW * 0.8, d.hullH * 0.5, 0.3, hull, 0, 0, 0, 0.62, 1);
      ap.rotateX(glacisDrop + 0.18);
      ap.translate(0, hullY + d.hullH * 0.2, d.hullL / 2 - 0.05);
      parts.push(ap);
    }
    // upper glacis plate detail: driver hatch + periscopes
    parts.push(cyl(d.hullW * 0.13, d.hullW * 0.13, 0.08, 10, -d.hullW * 0.22, top + 0.03, d.hullL * 0.22, hull, 0, 0, 0, 1, 1, 0.05, 2));
    parts.push(bx(0.16, 0.07, 0.1, -d.hullW * 0.05, top + 0.04, d.hullL * 0.3, DARKSTEEL, 0, 0, 0, 0.04, 3));
    parts.push(bx(0.16, 0.07, 0.1, d.hullW * 0.05, top + 0.04, d.hullL * 0.3, DARKSTEEL, 0, 0, 0, 0.04, 3));
    // rear plate + engine deck grill
    const rear = bx(d.hullW * 0.96, d.hullH * 0.85, 0.4, hull, 0, 0, 0, -0.22, 1);
    rear.rotateX(0.18);
    rear.translate(0, hullY + d.hullH * 0.06, -d.hullL / 2 - 0.04);
    parts.push(rear);
    parts.push(bx(d.hullW * 0.62, 0.1, d.hullL * 0.34, 0, top + 0.04, -d.hullL * 0.26, DARKSTEEL, 0, 0, 0, 0.05, 4));
    // engine deck louvres
    for (let i = 0; i < 3; i++) {
      parts.push(bx(d.hullW * 0.5, 0.05, 0.08, 0, top + 0.09, -d.hullL * 0.16 - i * 0.24, 0x2e3236, 0, 0, 0, 0.04, 5));
    }

    // fenders + side skirts
    for (const s of [-1, 1]) {
      parts.push(bx(d.trackW + 0.26, 0.09, d.hullL + 0.5, s * (d.hullW / 2 + d.trackW / 2), top + 0.16, 0, hull, 0, 0, 0, 0.05, 6));
      // mudflaps
      parts.push(bx(d.trackW + 0.2, 0.34, 0.06, s * (d.hullW / 2 + d.trackW / 2), top - 0.08, d.hullL / 2 + 0.26, 0x26282b, 0.16, 0, 0, 0.04, 7));
      parts.push(bx(d.trackW + 0.2, 0.34, 0.06, s * (d.hullW / 2 + d.trackW / 2), top - 0.08, -d.hullL / 2 - 0.26, 0x26282b, -0.16, 0, 0, 0.04, 7));
      // segmented skirt
      const segs = 4;
      for (let i = 0; i < segs; i++) {
        const sz = d.hullL * 0.74 / segs;
        parts.push(bx(0.09, d.hullH * 0.52, sz - 0.08, s * (d.hullW / 2 + 0.03), hullY + d.hullH * 0.14, -d.hullL * 0.37 + (i + 0.5) * sz, hull, 0, 0, 0, 0.06, 8 + i));
      }
    }

    // headlights + brush guard
    for (const s of [-1, 1]) {
      parts.push(bx(0.16, 0.14, 0.08, s * d.hullW * 0.32, top - 0.28, d.hullL / 2 + 0.06, 0x1b1d1f, 0, 0, 0, 0.04, 9));
      parts.push(bx(0.05, 0.26, 0.05, s * d.hullW * 0.32 + 0.1, top - 0.2, d.hullL / 2 + 0.1, DARKSTEEL, 0, 0, s * -0.15, 0.04, 9));
      parts.push(bx(0.05, 0.26, 0.05, s * d.hullW * 0.32 - 0.1, top - 0.2, d.hullL / 2 + 0.1, DARKSTEEL, 0, 0, s * -0.15, 0.04, 9));
    }
    // tow hooks
    parts.push(bx(0.13, 0.15, 0.3, d.hullW * 0.26, y0 + 0.14, d.hullL / 2 + 0.12, GUNMETAL, 0, 0, 0, 0.03, 10));
    parts.push(bx(0.13, 0.15, 0.3, -d.hullW * 0.26, y0 + 0.14, d.hullL / 2 + 0.12, GUNMETAL, 0, 0, 0, 0.03, 10));
    // spare track links on the glacis
    for (let i = 0; i < 3; i++) {
      parts.push(bx(0.34, 0.07, 0.4, -d.hullW * 0.1 + i * 0.36, top - 0.02 + 0.05, d.hullL * 0.34, 0x24272a, 0.5, 0, 0, 0.05, 11));
    }

    // exhaust per class
    if (cls === 'heavy') {
      // twin rear stacks
      for (const s of [-1, 1]) {
        parts.push(cyl(0.1, 0.12, 0.62, 8, s * d.hullW * 0.3, top + 0.26, -d.hullL / 2 + 0.28, DARKSTEEL, 0.12, 0, 0, 1, 1, 0.05, 12));
        parts.push(cyl(0.11, 0.11, 0.06, 8, s * d.hullW * 0.3, top + 0.56, -d.hullL / 2 + 0.25, 0x1a1c1e, 0, 0, 0, 1, 1, 0.03, 12));
      }
      // rear fuel drums
      parts.push(cyl(0.24, 0.24, 0.62, 10, d.hullW * 0.22, top - 0.12, -d.hullL / 2 - 0.42, 0x4c5342, Math.PI / 2, 0, 0, 1, 1, 0.08, 13));
      parts.push(cyl(0.24, 0.24, 0.62, 10, -d.hullW * 0.22, top - 0.12, -d.hullL / 2 - 0.42, 0x4c5342, Math.PI / 2, 0, 0, 1, 1, 0.08, 13));
      this.exhaustLocal = new THREE.Vector3(0, top + 0.6, -d.hullL / 2 + 0.25);
    } else {
      parts.push(cyl(0.085, 0.095, 0.66, 8, -d.hullW * 0.28, top + 0.22, -d.hullL / 2 + 0.3, DARKSTEEL, 0.9, 0, 0, 1, 1, 0.05, 12));
      if (cls === 'medium') {
        parts.push(cyl(0.085, 0.095, 0.66, 8, d.hullW * 0.28, top + 0.22, -d.hullL / 2 + 0.3, DARKSTEEL, 0.9, 0, 0, 1, 1, 0.05, 12));
      }
      this.exhaustLocal = new THREE.Vector3(cls === 'medium' ? d.hullW * 0.28 : -d.hullW * 0.28, top + 0.5, -d.hullL / 2 + 0.3);
    }

    const merged = mergeGeometries(parts)!;
    const hullMesh = new THREE.Mesh(merged, this.hullMat);
    hullMesh.castShadow = true;
    hullMesh.receiveShadow = true;
    this.root.add(hullMesh);
    this.geoList.push(merged, ...parts);
  }

  // ------------------------------------------------------------------
  // turret per class
  // ------------------------------------------------------------------

  private buildTurret(hull: number): void {
    const d = this.spec.dims;
    const cls = this.spec.cls;
    const turretY = this.hullTopY;
    this.turretPivot.position.set(0, turretY, -d.hullL * 0.05);
    this.root.add(this.turretPivot);

    const parts: THREE.BufferGeometry[] = [];
    const th = d.turretH;

    if (cls === 'light') {
      // low rounded scout turret
      const body = cyl(d.hullW * 0.24, d.hullW * 0.33, th, 12, 0, th / 2, 0, hull, 0, 0, 0, 1.05, 1.35, 0.05, 21);
      parts.push(body);
      // wedge mantlet
      const mant = bx(d.hullW * 0.36, th * 0.55, 0.4, hull, 0, 0, 0, 0, 1);
      mant.rotateX(0.12);
      mant.translate(0, th * 0.42, d.hullW * 0.42);
      parts.push(mant);
      // stowage rack (thin frame)
      parts.push(bx(d.hullW * 0.5, 0.06, 0.06, 0, th * 0.55, -d.hullW * 0.62, DARKSTEEL, 0, 0, 0, 0.04, 22));
      parts.push(bx(0.05, th * 0.5, 0.05, d.hullW * 0.22, th * 0.32, -d.hullW * 0.6, DARKSTEEL, 0, 0, 0, 0.04, 22));
      parts.push(bx(0.05, th * 0.5, 0.05, -d.hullW * 0.22, th * 0.32, -d.hullW * 0.6, DARKSTEEL, 0, 0, 0, 0.04, 22));
    } else if (cls === 'medium') {
      // MBT turret: elongated drum + bustle
      const body = cyl(d.hullW * 0.26, d.hullW * 0.38, th, 12, 0, th / 2, 0, hull, 0, 0, 0, 1.1, 1.5, 0.05, 21);
      parts.push(body);
      const bustle = bx(d.hullW * 0.52, th * 0.6, 0.5, hull, 0, 0, 0, 0, 1);
      bustle.translate(0, th * 0.5, -d.hullW * 0.62);
      parts.push(bustle);
      const mant = bx(d.hullW * 0.4, th * 0.62, 0.42, hull, 0, 0, 0, 0, 1);
      mant.rotateX(-0.08);
      mant.translate(0, th * 0.44, d.hullW * 0.52);
      parts.push(mant);
      // commander cupola with MG pintle
      parts.push(cyl(0.2, 0.24, 0.2, 8, d.hullW * 0.15, th + 0.1, -d.hullW * 0.18, hull, 0, 0, 0, 1, 1, 0.05, 22));
      parts.push(cyl(0.03, 0.03, 0.5, 6, d.hullW * 0.15, th + 0.32, -d.hullW * 0.02, GUNMETAL, 0.5, 0, 0, 1, 1, 0.03, 22));
      // smoke launchers
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          parts.push(cyl(0.045, 0.045, 0.22, 6, s * d.hullW * 0.34, th * 0.62, -d.hullW * 0.28 + i * 0.13, 0x2e3236, 0, 0, 0, 1, 1, 0.03, 23));
        }
      }
    } else {
      // heavy: massive angular block turret
      parts.push(bx(d.hullW * 0.78, th, d.hullW * 0.95, 0, th / 2, -d.hullW * 0.05, hull, 0, 0, 0, 0.05, 21));
      // sloped cheek plates
      for (const s of [-1, 1]) {
        const cheek = bx(d.hullW * 0.3, th * 0.8, 0.5, hull, 0, 0, 0, 0, 1);
        cheek.rotateY(s * 0.5);
        cheek.translate(s * d.hullW * 0.32, th * 0.5, d.hullW * 0.4);
        parts.push(cheek);
      }
      // huge mantlet + gun cradle
      parts.push(bx(d.hullW * 0.52, th * 0.72, 0.55, 0, th * 0.46, d.hullW * 0.55, DARKSTEEL, 0, 0, 0, 0.05, 22));
      parts.push(bx(d.hullW * 0.3, th * 0.3, 0.7, 0, th * 0.4, d.hullW * 0.72, hull, 0, 0, 0, 0.05, 22));
      // rear bustle rack
      parts.push(bx(d.hullW * 0.6, th * 0.55, 0.4, 0, th * 0.5, -d.hullW * 0.72, 0x31352f, 0, 0, 0, 0.07, 23));
      // cupola (tall)
      parts.push(cyl(0.24, 0.3, 0.26, 8, d.hullW * 0.18, th + 0.12, -d.hullW * 0.2, hull, 0, 0, 0, 1, 1, 0.05, 23));
      parts.push(cyl(0.035, 0.035, 0.62, 6, d.hullW * 0.18, th + 0.42, -d.hullW * 0.04, GUNMETAL, 0.4, 0, 0, 1, 1, 0.03, 24));
      // turret side stowage bins
      for (const s of [-1, 1]) {
        parts.push(bx(0.14, th * 0.5, d.hullW * 0.4, s * d.hullW * 0.42, th * 0.42, -d.hullW * 0.1, 0x3a4034, 0, 0, 0, 0.06, 24));
      }
    }

    // antennas
    for (const s of [-1, 1]) {
      const ant = cyl(0.014, 0.02, cls === 'light' ? 1.7 : 1.4, 4, s * d.hullW * 0.3, th + 0.6, -d.hullW * 0.34, 0x1e2124, 0, 0, s * 0.12, 1, 1, 0.03, 25);
      parts.push(ant);
    }
    // turret ring detail
    parts.push(cyl(d.hullW * 0.42, d.hullW * 0.44, 0.06, 12, 0, 0.03, 0, DARKSTEEL, 0, 0, 0, 1, 1.1, 0.04, 26));

    const merged = mergeGeometries(parts)!;
    const turretMesh = new THREE.Mesh(merged, this.hullMat);
    turretMesh.castShadow = true;
    this.turretPivot.add(turretMesh);
    this.geoList.push(merged, ...parts);

    // ---- barrel assembly ----
    this.barrelPivot.position.set(0, d.turretH * 0.42, d.hullW * 0.45);
    this.turretPivot.add(this.barrelPivot);

    const bp: THREE.BufferGeometry[] = [];
    const gl = d.gunLen;
    const barrelR = cls === 'light' ? 0.1 : cls === 'medium' ? 0.125 : 0.155;
    // main tube in two sections (thermal sleeve look)
    bp.push(paint(new THREE.CylinderGeometry(barrelR * 0.92, barrelR, gl * 0.55, 12), GUNMETAL, 0.04, 31)
      .rotateX(Math.PI / 2).translate(0, 0, gl * 0.28));
    bp.push(paint(new THREE.CylinderGeometry(barrelR, barrelR * 0.96, gl * 0.45, 12), GUNMETAL, 0.04, 31)
      .rotateX(Math.PI / 2).translate(0, 0, gl * 0.775));
    if (cls === 'medium') {
      // fume extractor
      bp.push(paint(new THREE.CylinderGeometry(barrelR * 1.45, barrelR * 1.45, gl * 0.14, 12), 0x2c3034, 0.04, 32)
        .rotateX(Math.PI / 2).translate(0, 0, gl * 0.52));
      // small muzzle brake
      bp.push(paint(new THREE.CylinderGeometry(barrelR * 1.3, barrelR * 1.3, 0.3, 10), 0x2c3034, 0.04, 32)
        .rotateX(Math.PI / 2).translate(0, 0, gl - 0.16));
    } else if (cls === 'heavy') {
      bp.push(paint(new THREE.CylinderGeometry(barrelR * 1.35, barrelR * 1.35, gl * 0.16, 12), 0x2c3034, 0.04, 32)
        .rotateX(Math.PI / 2).translate(0, 0, gl * 0.5));
      // double-baffle muzzle brake
      bp.push(paint(new THREE.CylinderGeometry(barrelR * 1.7, barrelR * 1.7, 0.16, 10), 0x26292d, 0.04, 33)
        .rotateX(Math.PI / 2).translate(0, 0, gl - 0.42));
      bp.push(paint(new THREE.CylinderGeometry(barrelR * 1.7, barrelR * 1.7, 0.16, 10), 0x26292d, 0.04, 33)
        .rotateX(Math.PI / 2).translate(0, 0, gl - 0.2));
      bp.push(paint(new THREE.CylinderGeometry(barrelR * 1.55, barrelR * 1.55, 0.12, 10), 0x26292d, 0.04, 33)
        .rotateX(Math.PI / 2).translate(0, 0, gl - 0.31));
    } else {
      bp.push(paint(new THREE.CylinderGeometry(barrelR * 1.25, barrelR * 1.25, 0.2, 10), 0x2c3034, 0.04, 32)
        .rotateX(Math.PI / 2).translate(0, 0, gl - 0.12));
    }
    // bore
    bp.push(paint(new THREE.CylinderGeometry(barrelR * 0.62, barrelR * 0.62, 0.1, 10), 0x0a0b0c, 0, 34)
      .rotateX(Math.PI / 2).translate(0, 0, gl + 0.01));

    const bmerged = mergeGeometries(bp)!;
    const barrelMesh = new THREE.Mesh(bmerged, this.hullMat);
    barrelMesh.castShadow = true;
    this.barrelPivot.add(barrelMesh);
    (this as { barrelMesh: THREE.Mesh }).barrelMesh = barrelMesh;
    this.geoList.push(bmerged, ...bp);

    this.muzzle.position.set(0, 0, gl + 0.06);
    this.barrelPivot.add(this.muzzle);

    // turret-top accent chevron (team color, subtle)
    const accGeo = bx(0.5, 0.05, 0.7, 0, d.turretH + 0.035, -d.hullW * 0.05, this.accentHex, 0, 0, 0, 0.03, 41);
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
    this.nameSprite.scale.set(4.2, 1.05, 1);
    this.nameSprite.position.set(0, this.fullH + 0.95, 0);
    this.nameSprite.renderOrder = 10;
    this.root.add(this.nameSprite);
    this.drawNameplate(name, teamColor, 1);
  }

  drawNameplate(name: string, teamColor: number, hpFrac: number): void {
    if (!this.showNameplate) return;
    const ctx = this.nameCtx;
    ctx.clearRect(0, 0, 256, 64);
    // angular plate
    ctx.fillStyle = 'rgba(8, 12, 16, 0.72)';
    ctx.beginPath();
    ctx.moveTo(14, 4); ctx.lineTo(246, 4); ctx.lineTo(252, 34); ctx.lineTo(246, 58); ctx.lineTo(14, 58); ctx.lineTo(6, 34);
    ctx.closePath(); ctx.fill();
    const col = '#' + new THREE.Color(teamColor).getHexString();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#e8edf0';
    ctx.font = '700 24px Bahnschrift, "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 128, 23);
    // hp bar
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(22, 40, 212, 11);
    const pct = Math.max(0, Math.min(1, hpFrac));
    ctx.fillStyle = pct > 0.55 ? '#6fca5f' : pct > 0.25 ? '#e0a030' : '#ff5d5d';
    ctx.fillRect(22, 40, 212 * pct, 11);
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
    (this.blobShadow.material as THREE.MeshBasicMaterial).opacity = cloaked ? 0.08 : 0.42;
    if (this.showNameplate) this.nameSprite.visible = !cloaked;
  }

  setWreck(on: boolean): void {
    this.hullMat.color.set(on ? 0x3c3c3c : 0xffffff);
    this.hullMat.roughness = on ? 1 : 0.82;
    this.trackMatL.color.set(on ? 0x444444 : 0xffffff);
    this.trackMatR.color.set(on ? 0x444444 : 0xffffff);
    this.accentMat.emissiveIntensity = on ? 0 : 0.42;
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.root);
    for (const g of this.geoList) g.dispose();
    for (const m of this.matList) m.dispose();
    (this.blobShadow.material as THREE.Material).dispose();
    this.blobShadow.geometry.dispose();
    if (this.showNameplate) {
      this.nameTex.dispose();
      (this.nameSprite.material as THREE.SpriteMaterial).dispose();
    }
  }
}
