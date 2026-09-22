/**
 * TankAssetLibrary — loads Blender-exported GLB tank models (3 LODs each)
 * and instantiates rigged, per-battle clones.
 *
 * Node contract (see assets/tanks/_kit/tank_kit.py):
 *   TankRoot → Hull, Turret (empty pivot) → Cannon (empty pivot) → Muzzle (empty),
 *   TrackL/TrackR, Wheels_L/Wheels_R.
 * The clone rebinds Turret/Cannon/Muzzle into the engine's transform contract
 * (turret yaw around local Y, gun elevation around local X, recoil along local Z)
 * and clones materials so damage/cloak states stay per-instance.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TankSpec } from '../config/tanks';
import { blobShadowTexture } from '../render/Textures';

const LOD_DISTANCES = [0, 75, 160];

interface TankTemplate {
  levels: THREE.Object3D[];
}

export class TankAssetLibrary {
  private templates = new Map<string, TankTemplate>();
  private loader = new GLTFLoader();
  loaded = false;

  loadAll(ids: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
    const jobs: Promise<void>[] = [];
    let done = 0;
    const total = ids.length * 3;
    for (const id of ids) {
      for (let lod = 0; lod < 3; lod++) {
        const p = new Promise<void>((resolve) => {
          this.loader.load(
            `${import.meta.env.BASE_URL}tanks/${id}/${id}_LOD${lod}.glb`,
            (gltf) => {
              const t = this.templates.get(id) ?? { levels: [] };
              t.levels[lod] = gltf.scene;
              this.templates.set(id, t);
              done++;
              onProgress?.(done, total);
              resolve();
            },
            undefined,
            (err) => {
              console.error(`Failed to load tank model ${id} LOD${lod}`, err);
              done++;
              onProgress?.(done, total);
              resolve(); // never block boot on a missing asset
            },
          );
        });
        jobs.push(p);
      }
    }
    return Promise.all(jobs).then(() => { this.loaded = true; });
  }

  /** true when the tank has Blender assets (else the engine falls back to procedural) */
  has(id: string): boolean {
    const t = this.templates.get(id);
    return !!t && t.levels.filter(Boolean).length === 3;
  }

  instantiate(spec: TankSpec, teamColor: number, name: string): TankVisualGLB {
    return new TankVisualGLB(spec, teamColor, name, this);
  }
}

const _v1 = new THREE.Vector3();

export class TankVisualGLB {
  readonly root = new THREE.LOD();
  readonly turretPivot: THREE.Object3D;
  readonly barrelPivot: THREE.Object3D;
  readonly barrelMesh: THREE.Object3D;
  readonly muzzle: THREE.Object3D;
  readonly trackTexL: THREE.Texture | null = null;
  readonly trackTexR: THREE.Texture | null = null;
  readonly nameSprite!: THREE.Sprite;
  readonly blobShadow: THREE.Mesh;
  readonly halfL: number;
  readonly halfW: number;
  readonly fullH: number;
  readonly hullTopY: number;
  readonly barrelLen: number;
  exhaustLocal = new THREE.Vector3();

  private clonedMats: { mat: THREE.MeshStandardMaterial; color: THREE.Color; rough: number }[] = [];
  private nameCanvas!: HTMLCanvasElement;
  private nameCtx!: CanvasRenderingContext2D;
  private nameTex!: THREE.CanvasTexture;
  private showNameplate: boolean;
  private matList: THREE.Material[] = [];
  private accentHex: number;

  constructor(readonly spec: TankSpec, teamColor: number, name: string,
    library: TankAssetLibrary, opts?: { nameplate?: boolean }) {
    this.showNameplate = opts?.nameplate ?? true;
    this.accentHex = teamColor;
    const d = spec.dims;
    this.halfL = d.hullL / 2 + 0.15;
    this.halfW = d.hullW / 2 + d.trackW / 2;
    this.hullTopY = CLEARANCE_HULL + d.hullH;
    this.fullH = this.hullTopY + d.turretH + 0.1;
    this.barrelLen = d.gunLen;

    const template = (library as unknown as { templates: Map<string, { levels: THREE.Object3D[] }> }).templates.get(spec.id)!;
    for (let i = 0; i < 3; i++) {
      const level = template.levels[i].clone(true);
      this.prepareClone(level);
      this.root.addLevel(level, LOD_DISTANCES[i]);
    }

    // rebind rig nodes from the nearest level (names are identical across LODs)
    const level0 = this.root.levels[0].object;
    const find = (n: string) => {
      let found: THREE.Object3D | null = null;
      level0.traverse((o) => { if (!found && o.name === n) found = o; });
      return found;
    };
    const turret = find('Turret');
    const cannon = find('Cannon');
    const muzzle = find('Muzzle');
    this.turretPivot = turret ?? new THREE.Object3D();
    this.barrelPivot = cannon ?? new THREE.Object3D();
    this.barrelMesh = this.barrelPivot; // recoil = cannon node local -Z offset
    this.muzzle = muzzle ?? new THREE.Object3D();

    // contact shadow
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(this.halfW * 3.1, this.halfL * 2.15),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, opacity: 0.42, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.05;
    blob.renderOrder = 1;
    this.blobShadow = blob;
    this.root.add(blob);

    // team accents: small emissive plates on hull sides (engine-side, keeps teams readable)
    const accMat = new THREE.MeshStandardMaterial({
      color: teamColor, emissive: teamColor, emissiveIntensity: 0.42, roughness: 0.5,
    });
    this.matList.push(accMat);
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.7, 0.24), accMat);
      plate.position.set(s * (this.halfW + 0.02), this.hullTopY * 0.62, -d.hullL * 0.18);
      this.root.levels[0].object.add(plate);
    }

    this.exhaustLocal.set(0, this.hullTopY + 0.3, d.hullL / 2 - 0.4);

    if (this.showNameplate) {
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
    } else {
      this.nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ visible: false }));
    }
  }

  private prepareClone(level: THREE.Object3D): void {
    level.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = mats.map((m) => {
        const std = (m as THREE.MeshStandardMaterial).clone();
        this.clonedMats.push({ mat: std, color: std.color.clone(), rough: std.roughness });
        this.matList.push(std);
        return std;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
      mesh.frustumCulled = true;
    });
  }

  drawNameplate(name: string, teamColor: number, hpFrac: number): void {
    if (!this.showNameplate) return;
    const ctx = this.nameCtx;
    ctx.clearRect(0, 0, 256, 64);
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
    for (const rec of this.clonedMats) {
      if (on) {
        rec.mat.color.setHex(0x3a3a3a);
        rec.mat.roughness = 1;
        rec.mat.emissive?.setHex(0x000000);
      } else {
        rec.mat.color.copy(rec.color);
        rec.mat.roughness = rec.rough;
      }
      rec.mat.needsUpdate = true;
    }
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.root);
    for (const m of this.matList) m.dispose();
    (this.blobShadow.material as THREE.Material).dispose();
    this.blobShadow.geometry.dispose();
    if (this.showNameplate) {
      this.nameTex.dispose();
      (this.nameSprite.material as THREE.SpriteMaterial).dispose();
    }
  }
}

export const CLEARANCE_HULL = 0.55;
void _v1;
