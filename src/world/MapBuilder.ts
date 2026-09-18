/**
 * Builds the Ironridge Crossing battlefield from map config:
 * terrain mesh, roads, buildings, rocks, trees, cover walls, props.
 * Also registers collision boxes into PhysicsWorld and emits cover points for AI.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP_CONFIG, MAP_SIZE, MAP_HALF } from '../config/map';
import type { PhysicsWorld } from './Physics';
import { heightAt, roadDistance } from './Terrain';
import { groundTexture, roadTexture, buildingTexture, metalTexture } from '../render/Textures';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MapData {
  group: THREE.Group;
  coverPoints: THREE.Vector3[];
}

export function buildMap(scene: THREE.Scene, physics: PhysicsWorld): MapData {
  const rng = mulberry32(20260918);
  const group = new THREE.Group();
  scene.add(group);

  // ---------- terrain ----------
  const SEG = 128;
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x4f5c33);
  const cMid = new THREE.Color(0x6a7444);
  const cHigh = new THREE.Color(0x8a8358);
  const cRock = new THREE.Color(0x7b7a72);
  const tmpC = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const nrm = physics.normalAt(x, z);
    const t = Math.min(1, Math.max(0, (h - 1) / 12));
    tmpC.copy(cLow).lerp(cMid, Math.min(1, t * 2)).lerp(cHigh, Math.max(0, t * 2 - 1));
    if (nrm.y < 0.82) tmpC.lerp(cRock, (0.82 - nrm.y) * 2.2); // rocky slopes
    const jitter = 0.94 + rng() * 0.12;
    colors[i * 3] = tmpC.r * jitter;
    colors[i * 3 + 1] = tmpC.g * jitter;
    colors[i * 3 + 2] = tmpC.b * jitter;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({
    map: groundTexture(),
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'terrain';
  group.add(ground);

  // ---------- roads ----------
  const roadMat = new THREE.MeshStandardMaterial({
    map: roadTexture(),
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const roadGeos: THREE.BufferGeometry[] = [];
  for (const poly of MAP_CONFIG.roads) {
    for (let s = 0; s < poly.length - 1; s++) {
      const a = poly[s], b = poly[s + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(2, Math.ceil(len / 5));
      const verts: number[] = [];
      const uvs: number[] = [];
      const idx: number[] = [];
      const W = 4.5;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
        const y = heightAt(x, z) + 0.07;
        verts.push(x + -dz * W, y, z + dx * W);
        verts.push(x + dz * W, y, z + -dx * W);
        uvs.push(0, t * len / 9, 1, t * len / 9);
        if (i < steps) {
          const k = i * 2;
          idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      rg.setIndex(idx);
      rg.computeVertexNormals();
      roadGeos.push(rg);
    }
  }
  const roadMesh = new THREE.Mesh(mergeGeometries(roadGeos)!, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // ---------- buildings ----------
  const texBrick = buildingTexture('brick');
  const texConcrete = buildingTexture('concrete');
  const texBarn = buildingTexture('barn');
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x4c4a44, roughness: 0.95 });
  const roofMatBarn = new THREE.MeshStandardMaterial({ color: 0x5d4a35, roughness: 0.95 });
  for (const b of MAP_CONFIG.buildings) {
    const style = b.style ?? 'brick';
    const tex = style === 'brick' ? texBrick : style === 'concrete' ? texConcrete : texBarn;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const g = new THREE.BoxGeometry(b.w, b.h + 1.4, b.d);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    // scale window texture by face size
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4);
      const su = face === 2 || face === 3 ? b.w / 12 : (face === 0 || face === 1 ? b.d / 12 : b.w / 12);
      const sv = face === 2 || face === 3 ? b.d / 12 : b.h / 10;
      uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    }
    const mats = [wallMat, wallMat, roofMat, roofMat, wallMat, wallMat];
    if (style === 'barn') mats[2] = roofMatBarn, mats[3] = roofMatBarn;
    const mesh = new THREE.Mesh(g, mats as THREE.MeshStandardMaterial[]);
    const gy = heightAt(b.x, b.z);
    mesh.position.set(b.x, gy + b.h / 2 - 0.7, b.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    physics.addBox(b.x, b.z, b.w, b.d, b.h + 0.4, 'building');
  }

  // ---------- cover walls ----------
  const sandbagMat = new THREE.MeshStandardMaterial({ color: 0x8f815c, roughness: 1 });
  const concreteWallMat = new THREE.MeshStandardMaterial({ map: metalTexture(), color: 0x8d9295, roughness: 0.9 });
  for (const w of MAP_CONFIG.walls) {
    const mat = w.kind === 'sandbag' ? sandbagMat : concreteWallMat;
    const gy = heightAt(w.x, w.z);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), mat);
    mesh.position.set(w.x, gy + w.h / 2 - 0.2, w.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    physics.addBox(w.x, w.z, w.w, w.d, w.h, w.kind ?? 'wall');
  }

  // ---------- rocks (instanced) ----------
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d7f78, roughness: 1, flatShading: true });
  const rockRegions = MAP_CONFIG.rocks.regions;
  const rockCount = rockRegions.reduce((s, r) => s + r.count, 0);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  let ri = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const scl = new THREE.Vector3();
  for (const region of rockRegions) {
    for (let i = 0; i < region.count && ri < rockCount; i++) {
      const p = scatterPoint(region, rng);
      if (!p) continue;
      const s = MAP_CONFIG.rocks.scaleMin + rng() * (MAP_CONFIG.rocks.scaleMax - MAP_CONFIG.rocks.scaleMin);
      eul.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
      q.setFromEuler(eul);
      scl.set(s * (0.8 + rng() * 0.5), s * (0.7 + rng() * 0.5), s * (0.8 + rng() * 0.5));
      const gy = heightAt(p.x, p.z);
      m4.compose(new THREE.Vector3(p.x, gy + s * 0.25, p.z), q, scl);
      rocks.setMatrixAt(ri++, m4);
      physics.addBox(p.x, p.z, s * 1.5, s * 1.5, s * 1.1, 'rock');
    }
  }
  rocks.count = ri;
  group.add(rocks);

  // ---------- trees (instanced trunk + canopy) ----------
  const treeRegions = MAP_CONFIG.trees.regions;
  const treeCount = treeRegions.reduce((s, r) => s + r.count, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 4.4, 6);
  trunkGeo.translate(0, 2.2, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(2.6, 0);
  canopyGeo.scale(1, 1.25, 1);
  canopyGeo.translate(0, 5.6, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 1 }), treeCount);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ color: 0x46603a, roughness: 1, flatShading: true }), treeCount);
  trunks.castShadow = true;
  canopies.castShadow = true;
  let ti = 0;
  const canopyColor = new THREE.Color();
  for (const region of treeRegions) {
    for (let i = 0; i < region.count && ti < treeCount; i++) {
      const p = scatterPoint(region, rng);
      if (!p) continue;
      const s = 0.75 + rng() * 0.7;
      eul.set(0, rng() * Math.PI * 2, 0);
      q.setFromEuler(eul);
      const gy = heightAt(p.x, p.z);
      m4.compose(new THREE.Vector3(p.x, gy - 0.2, p.z), q, scl.set(s, s * (0.85 + rng() * 0.5), s));
      trunks.setMatrixAt(ti, m4);
      canopies.setMatrixAt(ti, m4);
      canopyColor.setHSL(0.26 + rng() * 0.06, 0.35 + rng() * 0.2, 0.28 + rng() * 0.1);
      canopies.setColorAt(ti, canopyColor);
      ti++;
      physics.addBox(p.x, p.z, 1.1, 1.1, 4.5, 'tree', false);
    }
  }
  trunks.count = ti;
  canopies.count = ti;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
  group.add(trunks);
  group.add(canopies);

  // ---------- props: crates & barrels near village / POIs ----------
  const crateGeos: THREE.BufferGeometry[] = [];
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.3, 10);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x6b5a3a, roughness: 0.8, metalness: 0.3 });
  const barrels = new THREE.InstancedMesh(barrelGeo, barrelMat, 14);
  let bi = 0;
  for (let i = 0; i < 22; i++) {
    const near = MAP_CONFIG.buildings[Math.floor(rng() * MAP_CONFIG.buildings.length)];
    const px = near.x + (rng() - 0.5) * (near.w + 8);
    const pz = near.z + (rng() - 0.5) * (near.d + 8);
    if (roadDistance(px, pz) < 5.5) continue;
    if (rng() > 0.55 && bi < 14) {
      const gy = heightAt(px, pz);
      eul.set(0, rng() * Math.PI, 0);
      q.setFromEuler(eul);
      m4.compose(new THREE.Vector3(px, gy + 0.65, pz), q, scl.set(1, 1, 1));
      barrels.setMatrixAt(bi++, m4);
      physics.addBox(px, pz, 1.2, 1.2, 1.3, 'barrel', false);
    } else if (crateGeos.length < 12) {
      const s = 1.1 + rng() * 0.7;
      const g = new THREE.BoxGeometry(s, s, s);
      const gy = heightAt(px, pz);
      g.translate(px, gy + s / 2 - 0.15, pz);
      crateGeos.push(g);
      physics.addBox(px, pz, s, s, s, 'crate', false);
    }
  }
  barrels.count = bi;
  barrels.castShadow = true;
  group.add(barrels);
  if (crateGeos.length > 0) {
    const crateMesh = new THREE.Mesh(
      mergeGeometries(crateGeos)!,
      new THREE.MeshStandardMaterial({ color: 0x7a6a4a, roughness: 1 }),
    );
    crateMesh.castShadow = true;
    crateMesh.receiveShadow = true;
    group.add(crateMesh);
  }

  // map border cliffs visual: skip (terrain border mountains + fog)

  return { group, coverPoints: generateCoverPoints(physics) };
}

/** tries to find a valid scatter point: not on road, not in spawn zones, inside map */
function scatterPoint(
  region: { x: number; z: number; w: number; d: number },
  rng: () => number,
): { x: number; z: number } | null {
  for (let tries = 0; tries < 10; tries++) {
    const x = region.x + (rng() - 0.5) * region.w;
    const z = region.z + (rng() - 0.5) * region.d;
    if (Math.abs(x) > MAP_HALF - 12 || Math.abs(z) > MAP_HALF - 12) continue;
    if (roadDistance(x, z) < 8) continue;
    if (Math.hypot(x, z - 138) < 30 || Math.hypot(x, z + 138) < 30) continue;
    let blocked = false;
    for (const b of MAP_CONFIG.buildings) {
      if (Math.abs(x - b.x) < b.w / 2 + 4 && Math.abs(z - b.z) < b.d / 2 + 4) { blocked = true; break; }
    }
    if (blocked) continue;
    return { x, z };
  }
  return null;
}

/** cover positions around obstacles where a tank can hide its hull */
function generateCoverPoints(physics: PhysicsWorld): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (const ob of physics.obstacles) {
    if (ob.kind === 'tree' || ob.kind === 'barrel' || ob.kind === 'crate') continue;
    const cx = (ob.minX + ob.maxX) / 2;
    const cz = (ob.minZ + ob.maxZ) / 2;
    const hw = (ob.maxX - ob.minX) / 2;
    const hd = (ob.maxZ - ob.minZ) / 2;
    const off = 3.4;
    const candidates = [
      { x: cx, z: cz + hd + off },
      { x: cx, z: cz - hd - off },
      { x: cx + hw + off, z: cz },
      { x: cx - hw - off, z: cz },
    ];
    for (const c of candidates) {
      if (Math.abs(c.x) > MAP_HALF - 16 || Math.abs(c.z) > MAP_HALF - 16) continue;
      if (heightAt(c.x, c.z) > 14) continue; // don't hide on cliffs
      // not inside another obstacle
      let bad = false;
      for (const o2 of physics.obstacles) {
        if (o2 === ob) continue;
        if (c.x > o2.minX - 2.2 && c.x < o2.maxX + 2.2 && c.z > o2.minZ - 2.2 && c.z < o2.maxZ + 2.2) { bad = true; break; }
      }
      if (!bad) pts.push(new THREE.Vector3(c.x, heightAt(c.x, c.z), c.z));
    }
  }
  return pts;
}
