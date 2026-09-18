/**
 * Builds the Ironridge Crossing battlefield:
 * splat-blended terrain, two road types, multi-part buildings (houses,
 * blocks, barns, industry, ruins), military outposts with watchtowers,
 * power lines, wrecks, craters, containers, sandbag positions,
 * variant rocks and vegetation, a vehicle showroom pad and distant hills.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAP_CONFIG, MAP_SIZE, MAP_HALF } from '../config/map';
import type { BuildingDef, WallDef } from '../config/map';
import type { PhysicsWorld } from './Physics';
import { heightAt, roadDistance } from './Terrain';
import { mulberry32 } from './scatter';
import {
  grassTexture, groundNormalTexture, dirtTexture, rockTexture, macroTexture,
  asphaltTexture, roadDirtTexture, wallTexture, roofTexture, trackTexture,
  grassBladeTexture, metalTexture,
} from '../render/Textures';
import { detailNormalTexture, roughnessNoiseTexture } from '../render/Textures';

export interface MapData {
  group: THREE.Group;
  coverPoints: THREE.Vector3[];
  showroom: { x: number; z: number };
  windUniform: { value: number };
}

// ---------------------------------------------------------------------------
// shared geometry helpers
// ---------------------------------------------------------------------------

function paint(geo: THREE.BufferGeometry, color: number, jitter = 0.05): THREE.BufferGeometry {
  const base = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 - 0.5) * 2 * jitter;
    arr[i * 3] = base.r * j;
    arr[i * 3 + 1] = base.g * j;
    arr[i * 3 + 2] = base.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function scaleUV(geo: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

function bx(w: number, h: number, d: number, x: number, y: number, z: number,
  rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** triangular gable roof prism, ridge along local X */
function gableRoof(w: number, d: number, rh: number): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;
  const v = [
    // slope +z: (-hw,0,hd),(hw,0,hd),(hw,rh,0),(-hw,rh,0)
    -hw, 0, hd, hw, 0, hd, hw, rh, 0, -hw, 0, hd, hw, rh, 0, -hw, rh, 0,
    // slope -z
    hw, 0, -hd, -hw, 0, -hd, -hw, rh, 0, hw, 0, -hd, -hw, rh, 0, hw, rh, 0,
    // gable ends
    -hw, 0, -hd, -hw, 0, hd, -hw, rh, 0,
    hw, 0, hd, hw, 0, -hd, hw, rh, 0,
    // bottom (skip, unseen)
  ];
  const uv = [
    0, 0, w / 3, 0, w / 3, rh + 0.4, 0, 0, w / 3, rh + 0.4, 0, rh + 0.4,
    0, 0, w / 3, 0, w / 3, rh + 0.4, 0, 0, w / 3, rh + 0.4, 0, rh + 0.4,
    0, 0, d / 3, 0, d / 6, rh, 0, 0, d / 3, 0, d / 6, rh,
    0, 0, d / 3, 0, d / 6, rh, 0, 0, d / 3, 0, d / 6, rh,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// material library (created once per build)
// ---------------------------------------------------------------------------

interface Mats {
  ground: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  roadDirt: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  metalPanel: THREE.MeshStandardMaterial;
  sandbag: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  wreck: THREE.MeshStandardMaterial;
  [k: string]: THREE.MeshStandardMaterial;
}

function buildMaterials(): Mats {
  const detail = detailNormalTexture();
  const rough = roughnessNoiseTexture();
  const std = (o: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial(o);
    m.vertexColors = true;
    m.normalMap = detail;
    m.normalScale = new THREE.Vector2(0.4, 0.4);
    m.roughnessMap = rough;
    if (m.roughness === undefined) m.roughness = 0.9;
    return m;
  };

  // terrain with slope/macro splat blending
  const ground = new THREE.MeshStandardMaterial({
    map: grassTexture(), normalMap: groundNormalTexture(),
    vertexColors: true, roughness: 1, metalness: 0,
  });
  ground.onBeforeCompile = (shader) => {
    shader.uniforms.tDirt = { value: dirtTexture() };
    shader.uniforms.tRock = { value: rockTexture() };
    shader.uniforms.tMacro = { value: macroTexture() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWNorm = normalize(mat3(modelMatrix) * normal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nuniform sampler2D tDirt;\nuniform sampler2D tRock;\nuniform sampler2D tMacro;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float macro = texture2D(tMacro, vWPos.xz * 0.004).r;
          float slope = 1.0 - clamp(vWNorm.y, 0.0, 1.0);
          float rockA = smoothstep(0.30, 0.52, slope);
          float dirtA = clamp(macro * (1.0 - rockA) * 0.55, 0.0, 1.0);
          vec3 dirtC = texture2D(tDirt, vWPos.xz * 0.32).rgb;
          vec3 rockC = texture2D(tRock, vWPos.xz * 0.16).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, dirtC, dirtA);
          diffuseColor.rgb = mix(diffuseColor.rgb, rockC, rockA);
        }`,
      );
  };

  return {
    ground,
    asphalt: std({ map: asphaltTexture(), roughness: 0.94 }),
    roadDirt: std({ map: roadDirtTexture(), roughness: 1 }),
    plaster: std({ map: wallTexture('plaster'), roughness: 0.95 }),
    brick: std({ map: wallTexture('brickOld'), roughness: 0.95 }),
    panel: std({ map: wallTexture('panel'), roughness: 0.9 }),
    wood: std({ map: wallTexture('wood'), roughness: 1 }),
    metalPanel: std({ map: wallTexture('metalPanel'), roughness: 0.6, metalness: 0.5 }),
    sandbag: std({ map: wallTexture('sandbag'), roughness: 1 }),
    roof: std({ map: roofTexture(), roughness: 0.9 }),
    concrete: std({ color: 0x8d8f8a, roughness: 0.95 }),
    darkMetal: std({ map: metalTexture(), color: 0x5a6064, roughness: 0.55, metalness: 0.7 }),
    rust: std({ map: wallTexture('metalPanel'), color: 0x8a6a4a, roughness: 0.85, metalness: 0.4 }),
    wreck: std({ color: 0x2e2c2a, roughness: 1, metalness: 0.3 }),
    rockA: std({ map: rockTexture(), color: 0x9a968c, roughness: 1 }),
    rockB: std({ map: rockTexture(), color: 0x7e7a70, roughness: 1 }),
    pineTrunk: std({ color: 0x4a3826, roughness: 1 }),
    oakTrunk: std({ color: 0x554130, roughness: 1 }),
    birchTrunk: std({ color: 0xcfc9b8, roughness: 0.9 }),
    pineCanopy: std({ color: 0xffffff, roughness: 1, flatShading: true }),
    oakCanopy: std({ color: 0xffffff, roughness: 1, flatShading: true }),
    birchCanopy: std({ color: 0xffffff, roughness: 1, flatShading: true }),
    bush: std({ color: 0xffffff, roughness: 1, flatShading: true }),
    accentGold: std({ color: 0x30240c, emissive: 0xd8a03a, emissiveIntensity: 1.6, roughness: 0.4 }),
    lampGlow: std({ color: 0x111111, emissive: 0xfff2cc, emissiveIntensity: 3.2, roughness: 0.4 }),
    beacon: std({ color: 0x220404, emissive: 0xff3020, emissiveIntensity: 3.4, roughness: 0.4 }),
    scorch: std({ color: 0xffffff, roughness: 1 }),
    tuft: std({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide, alphaTest: 0.45 }),
  } as Mats;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export function buildMap(scene: THREE.Scene, physics: PhysicsWorld): MapData {
  const rng = mulberry32(20260918);
  const group = new THREE.Group();
  scene.add(group);
  const M = buildMaterials();
  const bucket: Record<string, THREE.BufferGeometry[]> = {};
  const add = (mat: keyof Mats | string, geo: THREE.BufferGeometry) => {
    (bucket[mat as string] ??= []).push(geo);
  };

  // ---------------- terrain ----------------
  const SEG = 128;
  const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cLow = new THREE.Color(0x55663a);
  const cMid = new THREE.Color(0x6a7444);
  const cHigh = new THREE.Color(0x8a8358);
  const tmpC = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    const t = Math.min(1, Math.max(0, (heightAt(x, z) - 0.5) / 11));
    tmpC.copy(cLow).lerp(cMid, Math.min(1, t * 1.8)).lerp(cHigh, Math.max(0, t * 1.8 - 1));
    const jitter = 0.92 + rng() * 0.16;
    colors[i * 3] = tmpC.r * jitter;
    colors[i * 3 + 1] = tmpC.g * jitter;
    colors[i * 3 + 2] = tmpC.b * jitter;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, M.ground);
  ground.receiveShadow = true;
  ground.name = 'terrain';
  group.add(ground);

  // ---------------- roads ----------------
  buildRoad(0, 9.5, 1);   // main NS road = asphalt
  buildRoad(1, 9, 0);     // EW roads = dirt
  buildRoad(2, 9, 0);
  for (let s = 3; s < MAP_CONFIG.roads.length; s++) buildRoad(s, 6.5, 0);

  function buildRoad(index: number, halfW: number, kind: 0 | 1): void {
    const poly = MAP_CONFIG.roads[index];
    const geos: THREE.BufferGeometry[] = [];
    for (let s = 0; s < poly.length - 1; s++) {
      const a = poly[s], b = poly[s + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(2, Math.ceil(len / 5));
      const verts: number[] = [];
      const uvs: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
        const y = heightAt(x, z) + 0.06;
        verts.push(x + -dz * halfW, y, z + dx * halfW);
        verts.push(x + dz * halfW, y, z + -dx * halfW);
        uvs.push(0, t * len / 14, 1, t * len / 14);
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
      geos.push(rg);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, kind === 0 ? M.asphalt : M.roadDirt);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------------- buildings ----------------
  let styleIdx = 0;
  for (const b of MAP_CONFIG.buildings) {
    buildBuilding(b, rng, add, physics, styleIdx++);
  }

  // ---------------- cover walls (sandbags / concrete) ----------------
  for (const w of MAP_CONFIG.walls) {
    buildWall(w, add, physics, rng);
  }

  // ---------------- forward outposts (military) ----------------
  buildOutpost(-34, 96, 0.3, rng, add, physics);
  buildOutpost(38, -98, Math.PI + 0.12, rng, add, physics);

  // ---------------- center crossing dressing ----------------
  buildWreckTank(6, -6, 0.7, rng, add, physics);
  buildCraters(rng, add);
  // jersey barriers on the north/south approaches
  for (const [bx0, bz, rot] of [[-5, -70, 0], [6, 70, 0], [-70, 7, Math.PI / 2], [72, -6, Math.PI / 2]] as const) {
    buildJerseyRow(bx0, bz, rot, add, physics);
  }

  // ---------------- containers near village & industry ----------------
  buildContainer(58, 28, 0.4, rng, add, physics);
  buildContainer(60.5, 31.5, 0.42 + 0.03, rng, add, physics);
  buildContainer(56, 24, Math.PI / 2 + 0.1, rng, add, physics);
  buildContainer(128, -40, 0.2, rng, add, physics);

  // ---------------- power line along the main road ----------------
  buildPowerLine(rng, add);

  // ---------------- rocks (3 deformed variants) ----------------
  buildRocks(rng, add, physics);

  // ---------------- vegetation (3 tree variants + bushes + grass) ----------------
  const windUniform = { value: 0 };
  const tuftMat = new THREE.MeshStandardMaterial({
    map: grassBladeTexture(), color: 0xffffff, roughness: 1, side: THREE.DoubleSide, alphaTest: 0.45,
  });
  tuftMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iOrigin = vec3(0.0);
        #endif
        float sway = sin(uTime * 1.7 + iOrigin.x * 0.35 + iOrigin.z * 0.31) * 0.12 * max(0.0, position.y);
        transformed.x += sway;
        transformed.z += sway * 0.6;`,
      );
  };
  M.tuft = tuftMat;
  buildVegetation(rng, add, physics, windUniform);

  // ---------------- showroom pad ----------------
  buildShowroom(add, physics);

  // ---------------- distant hills ring ----------------
  buildDistantHills(rng, group);

  // flush material buckets
  for (const [matName, geos] of Object.entries(bucket)) {
    if (geos.length === 0) continue;
    if (matName === 'wires') {
      const merged = mergeGeometries(geos)!;
      const lines = new THREE.LineSegments(merged, new THREE.LineBasicMaterial({ color: 0x191b1d }));
      group.add(lines);
      continue;
    }
    // normalize: non-indexed + color attribute everywhere so merge can't fail
    const fixed = geos.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      if (!ng.attributes.color) paint(ng, 0xffffff, 0.02);
      return ng;
    });
    const mat = (M as Record<string, THREE.MeshStandardMaterial>)[matName] ?? M.concrete;
    const merged = mergeGeometries(fixed);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = !['scorch', 'tuft', 'accentGold', 'lampGlow', 'beacon'].includes(matName);
    mesh.receiveShadow = matName !== 'tuft';
    group.add(mesh);
  }

  return { group, coverPoints: generateCoverPoints(physics), showroom: { x: -20, z: -30 }, windUniform };
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

function buildBuilding(b: BuildingDef, rng: () => number, add: (m: string, g: THREE.BufferGeometry) => void,
  physics: PhysicsWorld, styleIdx: number): void {
  const gy = heightAt(b.x, b.z);
  const baseY = gy - 0.5;
  const type = b.style ?? (styleIdx % 4 === 0 ? 'block' : 'house');
  const wallMat = type === 'barn' ? 'wood' : styleIdx % 2 === 0 ? 'plaster' : 'brick';
  const wu = Math.max(1, b.w / 7);
  const hv = Math.max(1, b.h / 5);

  if (type === 'ruin') {
    // broken wall segments + rubble
    const segs = 3;
    for (let i = 0; i < segs; i++) {
      const hh = b.h * (0.35 + rng() * 0.5);
      const ww = b.w / segs;
      add(wallMat, scaleUV(bx(ww, hh, b.d, b.x - b.w / 2 + ww * (i + 0.5), baseY + hh / 2, b.z, (rng() - 0.5) * 0.08), wu, hv));
    }
    for (let i = 0; i < 8; i++) {
      const s = 0.4 + rng() * 1.2;
      add('concrete', paint(new THREE.DodecahedronGeometry(s, 0), 0x8a8a82, 0.12)
        .translate(b.x + (rng() - 0.5) * b.w, baseY + s * 0.3, b.z + (rng() - 0.5) * b.d));
    }
    // fallen beam
    add('wood', bx(0.3, 0.3, b.d * 0.9, b.x + b.w * 0.3, baseY + 0.3, b.z + 1, 0, 0.2, 0.1));
    physics.addBox(b.x, b.z, b.w, b.d, b.h * 0.6, 'building');
    return;
  }

  // walls
  add(wallMat, scaleUV(bx(b.w, b.h + 1.3, b.d, b.x, baseY + (b.h + 1.3) / 2, b.z), wu, hv));
  physics.addBox(b.x, b.z, b.w, b.d, b.h + 0.4, 'building');

  if (type === 'house' || type === 'barn') {
    // gable roof with overhang + chimney
    const roof = gableRoof(b.w + 0.9, b.d + 0.9, Math.min(2.6, b.h * 0.42));
    roof.translate(b.x, gy + b.h - 0.35, b.z);
    add('roof', roof);
    if (type === 'house' && rng() > 0.35) {
      add('brick', bx(0.8, 1.6 + rng(), 0.8, b.x + b.w * 0.24, gy + b.h + 1.1, b.z - b.d * 0.15));
    }
  } else if (type === 'block') {
    // parapet + roof slab
    add('concrete', bx(b.w + 0.3, 0.25, b.d + 0.3, b.x, gy + b.h + 0.1, b.z));
    for (const [ox, oz, sw, sd] of [[0, b.d / 2, b.w + 0.4, 0.3], [0, -b.d / 2, b.w + 0.4, 0.3], [b.w / 2, 0, 0.3, b.d + 0.4], [-b.w / 2, 0, 0.3, b.d + 0.4]] as const) {
      add('concrete', bx(sw, 0.8, sd, b.x + ox, gy + b.h + 0.55, b.z + oz));
    }
    // rooftop vents
    for (let i = 0; i < 3; i++) {
      add('darkMetal', bx(0.5, 0.5, 0.5, b.x + (rng() - 0.5) * b.w * 0.6, gy + b.h + 0.4, b.z + (rng() - 0.5) * b.d * 0.5));
    }
  } else if (type === 'industrial') {
    // silos + chimney + pipe
    for (let i = 0; i < 2; i++) {
      const sx = b.x + b.w / 2 + 2.6 + i * 3.4;
      const silo = paint(new THREE.CylinderGeometry(1.5, 1.5, 7.5, 12), 0xb8b2a4, 0.05).translate(sx, gy + 3.75, b.z);
      add('panel', scaleUV(silo, 4, 2));
      const cone = paint(new THREE.ConeGeometry(1.55, 1.2, 12), 0x8a8578, 0.05).translate(sx, gy + 8.1, b.z);
      add('rust', cone);
      physics.addBox(sx, b.z, 3, 3, 8, 'building');
    }
    add('brick', bx(1.1, b.h + 4.5, 1.1, b.x - b.w / 2 - 1.4, gy + (b.h + 4.5) / 2, b.z - 2));
    physics.addBox(b.x - b.w / 2 - 1.4, b.z - 2, 1.4, 1.4, b.h + 4, 'building');
    add('darkMetal', bx(b.w * 0.7, 0.35, 0.35, b.x, gy + b.h * 0.75, b.z - b.d / 2 - 1.2));
    // flat hall roof
    add('darkMetal', bx(b.w + 0.3, 0.2, b.d + 0.3, b.x, gy + b.h + 0.05, b.z));
  }
}

function buildWall(w: WallDef, add: (m: string, g: THREE.BufferGeometry) => void,
  physics: PhysicsWorld, rng: () => number): void {
  const gy = heightAt(w.x, w.z);
  const mat = w.kind === 'sandbag' ? 'sandbag' : 'concrete';
  const cols = Math.max(1, Math.round(Math.max(w.w, w.d) / 2.6));
  for (let i = 0; i < cols; i++) {
    const t = cols === 1 ? 0.5 : i / (cols - 1);
    const sag = Math.sin(t * Math.PI) * 0.14;
    const x = w.w >= w.d ? w.x - w.w / 2 + w.w * (cols === 1 ? 0.5 : t) : w.x;
    const z = w.w >= w.d ? w.z : w.z - w.d / 2 + w.d * (cols === 1 ? 0.5 : t);
    const bw = w.w >= w.d ? Math.min(2.6, w.w / cols) + 0.05 : w.d;
    const bd = w.w >= w.d ? w.d : Math.min(2.6, w.d / cols) + 0.05;
    add(mat, scaleUV(bx(bw, w.h - sag, bd, x, gy + (w.h - sag) / 2 - 0.1, z, 0, (rng() - 0.5) * 0.05, 0), Math.max(1, bw / 2.2), Math.max(1, w.h / 1.6)));
  }
  physics.addBox(w.x, w.z, w.w, w.d, w.h, w.kind ?? 'wall');
}

function buildOutpost(cx: number, cz: number, rot: number, rng: () => number,
  add: (m: string, g: THREE.BufferGeometry) => void, physics: PhysicsWorld): void {
  const gy = heightAt(cx, cz);
  const R = 13;
  // perimeter concrete walls with a gap
  const sides: [number, number, number, number][] = [
    [cx - R, cz, 1.2, R * 2], [cx + R, cz, 1.2, R * 2],
    [cx, cz - R, R * 2, 1.2], [cx, cz + R * 0.55, R * 0.9, 1.2],
  ];
  for (const [x, z, w, d] of sides) {
    const yy = heightAt(x, z);
    add('panel', scaleUV(bx(w, 2.4, d, x, yy + 1.2, z), 3, 1.2));
    physics.addBox(x, z, w, d, 2.4, 'wall');
  }
  // watchtower
  const tx = cx + 5, tz = cz - 5;
  const ty = heightAt(tx, tz);
  for (const [ox, oz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]] as const) {
    const leg = bx(0.22, 5.4, 0.22, tx + ox, ty + 2.7, tz + oz, 0, 0, ox * oz > 0 ? 0.04 : -0.04);
    add('wood', leg);
  }
  add('wood', scaleUV(bx(3, 2.4, 3, tx, ty + 6.4, tz), 1.4, 1));
  add('wood', gableRoof(3.6, 3.6, 0.9).translate(tx, ty + 7.6, tz));
  physics.addBox(tx, tz, 2.6, 2.6, 7.6, 'building');
  // tents
  for (const [ox, oz, r] of [[-6, 4, 0.4], [-3, 6.5, -0.2]] as const) {
    const tent = gableRoof(3.2, 4, 1.4);
    tent.rotateY(r);
    tent.translate(cx + ox, heightAt(cx + ox, cz + oz) + 0.1, cz + oz);
    add('panel', tent);
    physics.addBox(cx + ox, cz + oz, 3, 4, 1.6, 'tent', false);
  }
  // antenna mast with beacon
  const mx = cx - 9, mz = cz + 2;
  const my = heightAt(mx, mz);
  add('darkMetal', bx(0.16, 9, 0.16, mx, my + 4.5, mz));
  add('darkMetal', bx(1.6, 0.1, 0.1, mx, my + 8.2, mz));
  add('darkMetal', bx(0.1, 0.1, 1.2, mx, my + 7.4, mz));
  add('beacon', paint(new THREE.SphereGeometry(0.14, 8, 6), 0xff3020).translate(mx, my + 9.1, mz));
}

function buildWreckTank(x: number, z: number, rot: number, rng: () => number,
  add: (m: string, g: THREE.BufferGeometry) => void, physics: PhysicsWorld): void {
  const gy = heightAt(x, z);
  const hullG = bx(3, 1.05, 5.8, 0, 0.55, 0, 0.04, rot, 0.03);
  hullG.translate(x, gy + 0.05, z);
  add('wreck', paint(hullG, 0x2e2c2a, 0.15));
  const turG = bx(2.1, 0.7, 2.6, 0.4, 0.95, -0.3, 0.05, rot + 0.8, -0.22);
  turG.translate(x, gy + 0.4, z);
  add('wreck', paint(turG, 0x282624, 0.15));
  const barrelG = paint(new THREE.CylinderGeometry(0.1, 0.12, 3.4, 8), 0x232120, 0.1)
    .rotateX(Math.PI / 2 - 0.3).rotateY(rot + 1.9).translate(x - 1.8, gy + 0.28, z + 1.6);
  add('wreck', barrelG);
  // scorch ring
  const scorch = paint(new THREE.CircleGeometry(4.2, 20), 0x1a1815, 0.1);
  scorch.rotateX(-Math.PI / 2);
  scorch.translate(x, gy + 0.09, z);
  add('scorch', scorch);
  physics.addBox(x, z, 5.4, 6.2, 1.6, 'rock');
}

function buildCraters(rng: () => number, add: (m: string, g: THREE.BufferGeometry) => void): void {
  const spots: [number, number][] = [[-12, 18], [22, -24], [-38, -12], [14, 44], [-18, 62]];
  for (const [x, z] of spots) {
    const gy = heightAt(x, z);
    const r = 2.2 + rng() * 2;
    const ring = paint(new THREE.CircleGeometry(r, 16), 0x3a332a, 0.15);
    ring.rotateX(-Math.PI / 2);
    ring.translate(x, gy + 0.08, z);
    add('scorch', ring);
    for (let i = 0; i < 5; i++) {
      const s = 0.25 + rng() * 0.4;
      const a = rng() * Math.PI * 2;
      add('concrete', paint(new THREE.DodecahedronGeometry(s, 0), 0x6a675e, 0.15)
        .translate(x + Math.cos(a) * r * 0.9, gy + s * 0.3, z + Math.sin(a) * r * 0.9));
    }
  }
}

function buildJerseyRow(x: number, z: number, rot: number, add: (m: string, g: THREE.BufferGeometry) => void,
  physics: PhysicsWorld): void {
  const gy = heightAt(x, z);
  for (let i = -1; i <= 1; i++) {
    const g = bx(2.3, 0.85, 0.55, x + Math.cos(rot) * i * 2.4, gy + 0.4, z + Math.sin(rot) * i * 2.4, 0, rot, 0);
    add('concrete', scaleUV(g, 1.5, 0.8));
  }
  physics.addBox(x, z, rot === 0 ? 7.2 : 1.2, rot === 0 ? 1.2 : 7.2, 0.85, 'wall');
}

function buildContainer(x: number, z: number, rot: number, rng: () => number,
  add: (m: string, g: THREE.BufferGeometry) => void, physics: PhysicsWorld): void {
  const gy = heightAt(x, z);
  const g = bx(2.45, 2.6, 6.1, 0, 0, 0, 0, rot, 0);
  g.translate(x, gy + 1.3, z);
  add('rust', scaleUV(g, 2.5, 1));
  physics.addBox(x, z, rot > 0.7 ? 6.2 : 2.5, rot > 0.7 ? 2.5 : 6.2, 2.6, 'building');
}

function buildPowerLine(rng: () => number, add: (m: string, g: THREE.BufferGeometry) => void): void {
  const wirePts: number[] = [];
  let prevTop: THREE.Vector3[] | null = null;
  for (let z = -140; z <= 140; z += 35) {
    if (Math.abs(z) < 14) continue; // gap at the crossing
    const x = 7.5;
    const gy = heightAt(x, z);
    add('wood', paint(new THREE.CylinderGeometry(0.14, 0.18, 7.2, 6), 0x4c3d2c, 0.1).translate(x, gy + 3.6, z));
    add('wood', bx(2.1, 0.14, 0.14, x, gy + 6.7, z));
    add('darkMetal', bx(0.1, 0.28, 0.1, x - 0.7, gy + 6.9, z));
    add('darkMetal', bx(0.1, 0.28, 0.1, x + 0.7, gy + 6.9, z));
    const tops = [new THREE.Vector3(x - 0.7, gy + 7, z), new THREE.Vector3(x + 0.7, gy + 7, z)];
    if (prevTop) {
      for (let wi = 0; wi < 2; wi++) {
        const a = prevTop[wi], b = tops[wi];
        const segs = 8;
        for (let s = 0; s < segs; s++) {
          const t0 = s / segs, t1 = (s + 1) / segs;
          const sag0 = Math.sin(t0 * Math.PI) * 0.85;
          const sag1 = Math.sin(t1 * Math.PI) * 0.85;
          wirePts.push(
            a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0 - sag0, a.z + (b.z - a.z) * t0,
            a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1 - sag1, a.z + (b.z - a.z) * t1,
          );
        }
      }
    }
    prevTop = tops;
  }
  const wires = new THREE.BufferGeometry();
  wires.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  (add as (m: string, g: THREE.BufferGeometry) => void)('wires', wires);
}

function deformedRockGeo(seed: number, radius: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(radius, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  // weld verts by position so displacement is continuous
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const key = Math.round(vx * 7) + Math.round(vy * 7) * 31 + Math.round(vz * 7) * 961;
    const k = (key % 997) / 997;
    const s = 0.75 + k * 0.5;
    p.setXYZ(i, vx * s, vy * s * 0.82, vz * s);
  }
  g.computeVertexNormals();
  return g;
}

function buildRocks(rng: () => number, add: (m: string, g: THREE.BufferGeometry) => void, physics: PhysicsWorld): void {
  const regions = MAP_CONFIG.rocks.regions;
  const variants = [deformedRockGeo(11, 1), deformedRockGeo(22, 1), deformedRockGeo(33, 1)];
  const buckets: THREE.BufferGeometry[][] = [[], [], []];
  let vi = 0;
  for (const region of regions) {
    for (let i = 0; i < region.count; i++) {
      const p = scatterPoint(region, rng);
      if (!p) continue;
      const s = MAP_CONFIG.rocks.scaleMin + rng() * (MAP_CONFIG.rocks.scaleMax - MAP_CONFIG.rocks.scaleMin);
      const gy = heightAt(p.x, p.z);
      const g = variants[vi % 3].clone();
      g.scale(s * (0.8 + rng() * 0.5), s * (0.7 + rng() * 0.5), s * (0.8 + rng() * 0.5));
      g.rotateY(rng() * Math.PI * 2);
      g.translate(p.x, gy + s * 0.22, p.z);
      buckets[vi % 3].push(g);
      physics.addBox(p.x, p.z, s * 1.5, s * 1.5, s * 1.1, 'rock');
      vi++;
    }
  }
  buckets.forEach((geos, i) => {
    for (const g of geos) add(i === 0 ? 'concrete' : i === 1 ? 'rockA' : 'rockB', g);
  });
}

function buildVegetation(rng: () => number, add: (m: string, g: THREE.BufferGeometry) => void,
  physics: PhysicsWorld, windUniform: { value: number }): void {
  const regions = MAP_CONFIG.trees.regions;
  const pineT: THREE.BufferGeometry[] = [], pineC: THREE.BufferGeometry[] = [];
  const oakT: THREE.BufferGeometry[] = [], oakC: THREE.BufferGeometry[] = [];
  const birchT: THREE.BufferGeometry[] = [], birchC: THREE.BufferGeometry[] = [];
  const bushG: THREE.BufferGeometry[] = [];
  const tuftG: THREE.BufferGeometry[] = [];

  let count = 0;
  for (const region of regions) {
    for (let i = 0; i < region.count; i++) {
      const p = scatterPoint(region, rng);
      if (!p) continue;
      const gy = heightAt(p.x, p.z);
      const s = 0.75 + rng() * 0.7;
      const kind = rng();
      const ry = rng() * Math.PI * 2;
      count++;
      physics.addBox(p.x, p.z, 1.1, 1.1, 4.5, 'tree', false);
      if (kind < 0.4) {
        // pine
        const trunk = paint(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 2.6 * s, 6), 0x4a3826, 0.1)
          .translate(p.x, gy + 1.3 * s, p.z);
        pineT.push(trunk);
        for (let c = 0; c < 3; c++) {
          const cr = (1.7 - c * 0.42) * s;
          const ch = (1.9 - c * 0.28) * s;
          const cone = paint(new THREE.ConeGeometry(cr, ch, 7), c % 2 ? 0x2e4628 : 0x34502c, 0.12)
            .translate(p.x, gy + (2.4 + c * 1.35) * s, p.z);
          pineC.push(cone);
        }
      } else if (kind < 0.72) {
        // oak
        const trunk = paint(new THREE.CylinderGeometry(0.2 * s, 0.34 * s, 2.2 * s, 6), 0x554130, 0.1)
          .translate(p.x, gy + 1.1 * s, p.z).rotateY(ry);
        oakT.push(trunk);
        for (let c = 0; c < 3; c++) {
          const r = (1.15 + rng() * 0.5) * s;
          const blob = paint(new THREE.IcosahedronGeometry(r, 0), 0x3f5c30, 0.14)
            .translate(p.x + (rng() - 0.5) * 1.1 * s, gy + (2.9 + c * 0.85) * s, p.z + (rng() - 0.5) * 1.1 * s);
          oakC.push(blob);
        }
      } else {
        // birch
        const trunk = paint(new THREE.CylinderGeometry(0.1 * s, 0.15 * s, 3 * s, 6), 0xcfc9b8, 0.04)
          .translate(p.x, gy + 1.5 * s, p.z);
        birchT.push(trunk);
        for (let c = 0; c < 2; c++) {
          const r = (0.85 + rng() * 0.4) * s;
          const blob = paint(new THREE.IcosahedronGeometry(r, 0), 0x5f7c3c, 0.13)
            .translate(p.x + (rng() - 0.5) * 0.7 * s, gy + (3.2 + c * 0.8) * s, p.z + (rng() - 0.5) * 0.7 * s);
          birchC.push(blob);
        }
      }
    }
  }

  // bushes
  for (let i = 0; i < 70; i++) {
    const x = (rng() - 0.5) * 260, z = (rng() - 0.5) * 260;
    if (Math.abs(x) > MAP_HALF - 16 || Math.abs(z) > MAP_HALF - 16) continue;
    if (roadDistance(x, z) < 7) continue;
    const s = 0.5 + rng() * 0.7;
    bushG.push(paint(new THREE.IcosahedronGeometry(s, 0), 0x48603a, 0.16)
      .translate(x, heightAt(x, z) + s * 0.5, z));
  }

  // grass tufts (wind-swayed, alphaTest, no shadow)
  const tuftCount = 1300;
  for (let i = 0; i < tuftCount; i++) {
    const x = (rng() - 0.5) * 280, z = (rng() - 0.5) * 280;
    if (Math.abs(x) > MAP_HALF - 14 || Math.abs(z) > MAP_HALF - 14) continue;
    if (roadDistance(x, z) < 6.5) continue;
    if (Math.hypot(x, z - 138) < 26 || Math.hypot(x, z + 138) < 26) continue;
    const gy = heightAt(x, z);
    if (gy > 10) continue;
    const s = 0.7 + rng() * 0.8;
    const quad = new THREE.PlaneGeometry(s, s * 0.8);
    quad.translate(0, s * 0.4, 0);
    quad.rotateY(rng() * Math.PI);
    quad.translate(x, gy, z);
    tuftG.push(quad);
    const quad2 = new THREE.PlaneGeometry(s, s * 0.8);
    quad2.translate(0, s * 0.4, 0);
    quad2.rotateY(rng() * Math.PI + Math.PI / 2);
    quad2.translate(x, gy, z);
    tuftG.push(quad2);
  }

  for (const g of pineT) add('pineTrunk', g);
  for (const g of pineC) add('pineCanopy', g);
  for (const g of oakT) add('oakTrunk', g);
  for (const g of oakC) add('oakCanopy', g);
  for (const g of birchT) add('birchTrunk', g);
  for (const g of birchC) add('birchCanopy', g);
  for (const g of bushG) add('bush', g);
  for (const g of tuftG) add('tuft', g);
}

function buildShowroom(add: (m: string, g: THREE.BufferGeometry) => void, physics: PhysicsWorld): void {
  const { x, z } = { x: -20, z: -30 };
  const gy = heightAt(x, z);
  // podium
  const pod = paint(new THREE.CylinderGeometry(6.4, 6.8, 0.55, 24), 0x83857f, 0.05).translate(x, gy + 0.26, z);
  add('concrete', pod);
  const ring = paint(new THREE.TorusGeometry(5.9, 0.16, 8, 40), 0xd8a03a, 0.02);
  ring.rotateX(Math.PI / 2);
  ring.translate(x, gy + 0.56, z);
  add('accentGold', ring);
  // ramp
  const ramp = bx(4.6, 0.18, 3.2, x + 8.2, gy + 0.42, z, 0, 0, -0.12);
  add('concrete', ramp);
  // floodlight poles
  for (const a of [0.7, 2.3, 3.9, 5.5]) {
    const px = x + Math.cos(a) * 7.6, pz = z + Math.sin(a) * 7.6;
    const py = heightAt(px, pz);
    add('darkMetal', paint(new THREE.CylinderGeometry(0.09, 0.13, 5.2, 6), 0x3a3f43, 0.05).translate(px, py + 2.6, pz));
    const head = bx(0.5, 0.24, 0.3, px, py + 5.3, pz, 0, a + Math.PI / 2, 0);
    add('darkMetal', head);
    add('lampGlow', paint(new THREE.PlaneGeometry(0.44, 0.2), 0xfff2cc).translate(px, py + 5.16, pz));
  }
  physics.addBox(x, z, 13.4, 13.4, 0.6, 'podium', false);
}

function buildDistantHills(rng: () => number, group: THREE.Group): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0x55624a, roughness: 1, fog: true });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.2;
    const r = 330 + rng() * 60;
    const s = 60 + rng() * 90;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 7), mat);
    hill.scale.set(s, 14 + rng() * 22, s * 0.8);
    hill.position.set(Math.cos(a) * r, -4, Math.sin(a) * r);
    group.add(hill);
  }
  // far industrial silhouettes for the skyline story
  const dark = new THREE.MeshStandardMaterial({ color: 0x3c4248, roughness: 1 });
  for (const [a, h] of [[0.6, 26], [2.4, 34], [4.2, 22]] as const) {
    const r = 360;
    const chim = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 4.4, h, 8), dark);
    chim.position.set(Math.cos(a) * r, h / 2 - 6, Math.sin(a) * r);
    group.add(chim);
  }
}

// ---------------------------------------------------------------------------

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
    if (Math.hypot(x + 20, z + 30) < 15) continue; // showroom pad
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
    if (ob.kind === 'tree' || ob.kind === 'barrel' || ob.kind === 'crate' || ob.kind === 'podium') continue;
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
      if (heightAt(c.x, c.z) > 14) continue;
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
