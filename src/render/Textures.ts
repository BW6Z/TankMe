/**
 * Procedural PBR texture factory.
 * Every texture in the game is generated at runtime — albedo, normal maps
 * derived from height functions, roughness variation, weathering and grime.
 */
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// noise helpers (tileable value noise + fbm)
// ---------------------------------------------------------------------------

export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** tileable value noise grid with bilinear-smooth sampling */
function noiseField(cells: number, rng: () => number): (x: number, y: number) => number {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) g[i] = rng();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const gx = x * cells, gy = y * cells;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = smooth(gx - x0), fy = smooth(gy - y0);
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const a = g[(y0 % cells) * cells + (x0 % cells)];
    const b = g[(y0 % cells) * cells + x1];
    const c = g[y1 * cells + (x0 % cells)];
    const d = g[y1 * cells + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function fbmField(seed: number, baseCells: number, octaves: number): (x: number, y: number) => number {
  const layers: ((x: number, y: number) => number)[] = [];
  const amps: number[] = [];
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    layers.push(noiseField(baseCells << o, makeRng(seed + o * 131)));
    amps.push(amp); total += amp; amp *= 0.55;
  }
  return (x, y) => {
    let v = 0;
    for (let o = 0; o < layers.length; o++) v += layers[o](x, y) * amps[o];
    return v / total;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function albedo(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function dataTexture(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

/** build a normal map from a height function (x,y in 0..1, tiled) */
export function normalFromHeight(
  size: number, heightFn: (x: number, y: number) => number, strength: number,
): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const step = 1 / size;
  const h = (x: number, y: number) => heightFn((x + 1) % 1, (y + 1) % 1);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h((x + 1) / size, y / size) - h((x - 1 + size) / size, y / size)) * strength;
      const dy = (h(x / size, (y + 1) / size) - h(x / size, (y - 1 + size) / size)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// shared material detail maps (metal wear, roughness noise)
// ---------------------------------------------------------------------------

let _detailNormal: THREE.CanvasTexture | null = null;
/** fine metal/armor detail normal map (subtle bumps, dents, weld seams) */
export function detailNormalTexture(): THREE.CanvasTexture {
  if (_detailNormal) return _detailNormal;
  const dent = fbmField(771, 8, 4);
  const rough = fbmField(314, 32, 2);
  const c = normalFromHeight(256, (x, y) => dent(x, y) * 0.7 + rough(x, y) * 0.3, 1.05);
  _detailNormal = dataTexture(c, 3, 3);
  return _detailNormal;
}

let _roughNoise: THREE.CanvasTexture | null = null;
/** grayscale roughness variation (paint sheen vs worn metal) */
export function roughnessNoiseTexture(): THREE.CanvasTexture {
  if (_roughNoise) return _roughNoise;
  const wear = fbmField(911, 6, 4);
  const [c, ctx] = makeCanvas(256, 256);
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const v = wear(x / 256, y / 256);
      // worn areas (low noise) are glossier: roughness 0.55..0.95
      const g = Math.round((0.95 - v * 0.4) * 255);
      const i = (y * 256 + x) * 4;
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _roughNoise = dataTexture(c, 4, 4);
  return _roughNoise;
}

// ---------------------------------------------------------------------------
// terrain splats
// ---------------------------------------------------------------------------

let _grass: THREE.CanvasTexture | null = null;
export function grassTexture(): THREE.CanvasTexture {
  if (_grass) return _grass;
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const blotch = fbmField(41, 6, 4);
  const bladeRng = makeRng(87);
  ctx.fillStyle = '#5c6b3c';
  ctx.fillRect(0, 0, S, S);
  // macro grass tint variation
  const img = ctx.getImageData(0, 0, S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = blotch(x / S, y / S);
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, 80 + v * 60);
      img.data[i + 1] = Math.min(255, 100 + v * 55);
      img.data[i + 2] = 52 + v * 40;
    }
  }
  ctx.putImageData(img, 0, 0);
  // grass blade strokes
  for (let i = 0; i < 5200; i++) {
    const x = bladeRng() * S, y = bladeRng() * S;
    const l = 3 + bladeRng() * 6, a = bladeRng() * Math.PI;
    const g = 90 + bladeRng() * 70;
    ctx.strokeStyle = `rgba(${(g * 0.62) | 0},${g | 0},${(g * 0.42) | 0},${0.25 + bladeRng() * 0.3})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l - l * 0.4);
    ctx.stroke();
  }
  // dry dirt patches
  for (let i = 0; i < 26; i++) {
    const x = bladeRng() * S, y = bladeRng() * S, r = 12 + bladeRng() * 42;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(118,102,66,0.35)');
    g.addColorStop(1, 'rgba(118,102,66,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  _grass = albedo(c, 56, 56);
  return _grass;
}

let _dirt: THREE.CanvasTexture | null = null;
export function dirtTexture(): THREE.CanvasTexture {
  if (_dirt) return _dirt;
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const n = fbmField(53, 6, 4);
  const rng = makeRng(19);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = n(x / S, y / S);
      const i = (y * S + x) * 4;
      img.data[i] = 96 + v * 52;
      img.data[i + 1] = 82 + v * 42;
      img.data[i + 2] = 58 + v * 30;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(60,50,34,0.3)' : 'rgba(150,132,96,0.25)';
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 2.5, 1 + rng() * 2.5);
  }
  _dirt = albedo(c, 90, 90);
  return _dirt;
}

let _rock: THREE.CanvasTexture | null = null;
export function rockTexture(): THREE.CanvasTexture {
  if (_rock) return _rock;
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const n = fbmField(67, 5, 5);
  const rng = makeRng(23);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = n(x / S, y / S);
      const strata = Math.sin((y / S) * 26 + v * 9) * 0.5 + 0.5; // sedimentary strata
      const g = 96 + v * 46 + strata * 16;
      const i = (y * S + x) * 4;
      img.data[i] = g; img.data[i + 1] = g * 0.97; img.data[i + 2] = g * 0.9;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = 'rgba(30,30,28,0.25)';
    ctx.fillRect(rng() * S, rng() * S, 1 + rng() * 3, 1 + rng() * 2);
  }
  _rock = albedo(c, 40, 40);
  return _rock;
}

/** macro mask that tells the terrain shader where dirt patches live */
let _macro: THREE.CanvasTexture | null = null;
export function macroTexture(): THREE.CanvasTexture {
  if (_macro) return _macro;
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const n = fbmField(89, 3, 4);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = Math.max(0, Math.min(1, (n(x / S, y / S) - 0.38) * 2.6));
      const i = (y * S + x) * 4;
      const g = Math.round(v * 255);
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _macro = dataTexture(c, 1, 1);
  return _macro;
}

export function groundNormalTexture(): THREE.CanvasTexture {
  const h = fbmField(41, 6, 4);
  const c = normalFromHeight(256, (x, y) => h(x, y), 1.6);
  return dataTexture(c, 56, 56);
}

// ---------------------------------------------------------------------------
// roads
// ---------------------------------------------------------------------------

export function asphaltTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const rng = makeRng(101);
  const n = fbmField(103, 16, 3);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = n(x / S, y / S);
      const g = 52 + v * 26;
      const i = (y * S + x) * 4;
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g + 3;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // gravel shoulders (v near edges → canvas y edges)
  ctx.fillStyle = 'rgba(112,100,76,0.9)';
  ctx.fillRect(0, 0, S, 14);
  ctx.fillRect(0, S - 14, S, 14);
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = 'rgba(90,82,64,0.8)';
    ctx.fillRect(rng() * S, (rng() * 12) | 0, 2, 2);
    ctx.fillRect(rng() * S, S - 2 - ((rng() * 12) | 0), 2, 2);
  }
  // cracks
  ctx.strokeStyle = 'rgba(18,18,20,0.55)';
  for (let i = 0; i < 9; i++) {
    let x = rng() * S, y = 16 + rng() * (S - 32);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rng() - 0.5) * 40; y += (rng() - 0.5) * 24;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // patch repairs
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = 'rgba(38,38,42,0.7)';
    ctx.fillRect(rng() * S, 20 + rng() * (S - 60), 20 + rng() * 40, 12 + rng() * 22);
  }
  // worn center dashes
  ctx.fillStyle = 'rgba(168,158,120,0.5)';
  for (let x = 0; x < S; x += 42) ctx.fillRect(x, S / 2 - 2, 22, 4);
  const t = albedo(c, 1, 1);
  return t;
}

export function roadDirtTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const rng = makeRng(117);
  const n = fbmField(121, 8, 4);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = n(x / S, y / S);
      const i = (y * S + x) * 4;
      img.data[i] = 116 + v * 40;
      img.data[i + 1] = 100 + v * 34;
      img.data[i + 2] = 70 + v * 24;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // twin wheel ruts
  for (const ry of [0.32, 0.68]) {
    const g = ctx.createLinearGradient(0, (ry - 0.09) * S, 0, (ry + 0.09) * S);
    g.addColorStop(0, 'rgba(78,64,44,0)');
    g.addColorStop(0.5, 'rgba(78,64,44,0.55)');
    g.addColorStop(1, 'rgba(78,64,44,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, (ry - 0.09) * S, S, 0.18 * S);
  }
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(60,48,30,0.3)' : 'rgba(160,142,104,0.28)';
    ctx.fillRect(rng() * S, rng() * S, 2, 2);
  }
  // grassy edges
  ctx.fillStyle = 'rgba(92,107,60,0.85)';
  ctx.fillRect(0, 0, S, 10);
  ctx.fillRect(0, S - 10, S, 10);
  return albedo(c, 1, 1);
}

// ---------------------------------------------------------------------------
// architecture
// ---------------------------------------------------------------------------

export type WallStyle = 'plaster' | 'brickOld' | 'panel' | 'wood' | 'metalPanel' | 'sandbag';

function windowsAndDoor(ctx: CanvasRenderingContext2D, S: number, rng: () => number, style: WallStyle): void {
  const dark = 'rgba(14,16,18,0.95)';
  const glass = 'rgba(96,118,130,0.5)';
  if (style === 'wood') {
    // barn door
    ctx.fillStyle = 'rgba(52,42,28,0.95)';
    ctx.fillRect(S * 0.36, S * 0.45, S * 0.28, S * 0.55);
    ctx.strokeStyle = 'rgba(30,24,16,0.9)';
    ctx.lineWidth = 4;
    ctx.strokeRect(S * 0.36, S * 0.45, S * 0.28, S * 0.55);
    ctx.beginPath(); ctx.moveTo(S * 0.36, S * 0.45); ctx.lineTo(S * 0.64, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(S * 0.64, S * 0.45); ctx.lineTo(S * 0.36, S); ctx.stroke();
    // hay window
    ctx.fillStyle = dark;
    ctx.fillRect(S * 0.12, S * 0.3, S * 0.14, S * 0.14);
    return;
  }
  // windows grid with frames, some broken
  const cols = 3, rows = 2;
  for (let r = 0; r < rows; r++) {
    for (let cI = 0; cI < cols; cI++) {
      const x = S * (0.12 + cI * 0.3), y = S * (0.16 + r * 0.34);
      const w = S * 0.16, h = S * 0.2;
      ctx.fillStyle = dark;
      ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
      const broken = rng() < 0.22;
      ctx.fillStyle = broken ? 'rgba(10,10,12,0.95)' : glass;
      ctx.fillRect(x, y, w, h);
      if (!broken) {
        ctx.fillStyle = 'rgba(180,200,210,0.18)';
        ctx.fillRect(x, y, w, h * 0.35);
        ctx.fillStyle = dark;
        ctx.fillRect(x + w / 2 - 2, y, 4, h);
        ctx.fillRect(x, y + h / 2 - 2, w, 4);
      } else {
        ctx.strokeStyle = 'rgba(200,205,210,0.25)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y + h * 0.3); ctx.lineTo(x + w * 0.7, y + h); ctx.stroke();
      }
      // sill
      ctx.fillStyle = 'rgba(120,116,108,0.8)';
      ctx.fillRect(x - 5, y + h + 3, w + 10, 5);
    }
  }
  // door
  ctx.fillStyle = 'rgba(38,32,26,0.95)';
  ctx.fillRect(S * 0.44, S * 0.66, S * 0.14, S * 0.34);
  ctx.strokeStyle = 'rgba(90,80,64,0.8)';
  ctx.strokeRect(S * 0.44, S * 0.66, S * 0.14, S * 0.34);
  // grime streaks under windows
  for (let cI = 0; cI < cols; cI++) {
    const x = S * (0.12 + cI * 0.3);
    const g = ctx.createLinearGradient(0, S * 0.4, 0, S * 0.55);
    g.addColorStop(0, 'rgba(40,38,32,0.4)');
    g.addColorStop(1, 'rgba(40,38,32,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, S * 0.38, S * 0.16, S * 0.2);
  }
}

export function wallTexture(style: WallStyle): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const rng = makeRng(style.length * 977 + 5);
  const n = fbmField(style.length * 31 + 7, 6, 4);
  const img = ctx.createImageData(S, S);
  const palette: Record<WallStyle, [number, number, number, number, number, number]> = {
    plaster: [172, 164, 148, 128, 120, 104],
    brickOld: [128, 92, 74, 88, 60, 48],
    panel: [148, 150, 148, 108, 110, 108],
    wood: [124, 100, 68, 84, 66, 44],
    metalPanel: [122, 128, 132, 84, 90, 94],
    sandbag: [148, 132, 100, 108, 96, 72],
  };
  const p = palette[style];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = n(x / S, y / S);
      const i = (y * S + x) * 4;
      img.data[i] = p[0] + (p[3] - p[0]) * v;
      img.data[i + 1] = p[1] + (p[4] - p[1]) * v;
      img.data[i + 2] = p[2] + (p[5] - p[2]) * v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  if (style === 'brickOld') {
    for (let y = 0; y < S; y += 13) {
      const off = (y / 13) % 2 === 0 ? 0 : -8;
      for (let x = off; x < S; x += 17) {
        ctx.fillStyle = `rgba(${70 + (rng() * 50) | 0},${44 + (rng() * 30) | 0},${34 + (rng() * 22) | 0},0.85)`;
        ctx.fillRect(x + 1, y + 1, 15, 11);
        ctx.fillStyle = 'rgba(52,50,46,0.7)';
        ctx.fillRect(x, y, 17, 1.6);
      }
    }
  } else if (style === 'panel') {
    // concrete panel seams + bolt dots
    ctx.strokeStyle = 'rgba(60,62,64,0.9)';
    ctx.lineWidth = 3;
    for (let x = 0; x <= S; x += S / 2) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
    ctx.fillStyle = 'rgba(70,72,74,0.9)';
    for (let y = 14; y < S; y += S / 2 - 28) {
      for (let x = 10; x < S; x += 26) ctx.fillRect(x, y, 4, 4);
    }
  } else if (style === 'wood') {
    for (let x = 0; x < S; x += 14) {
      ctx.fillStyle = `rgba(60,46,30,${0.35 + rng() * 0.3})`;
      ctx.fillRect(x, 0, 2, S);
    }
  } else if (style === 'metalPanel') {
    // corrugation
    for (let x = 0; x < S; x += 12) {
      const g = ctx.createLinearGradient(x, 0, x + 12, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.14)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0.06)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 12, S);
    }
    // rust patches
    for (let i = 0; i < 10; i++) {
      const x = rng() * S, y = rng() * S, r = 8 + rng() * 26;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(122,72,34,0.6)');
      g.addColorStop(1, 'rgba(122,72,34,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  } else if (style === 'sandbag') {
    // stacked bags
    ctx.fillStyle = 'rgba(0,0,0,0)';
    for (let row = 0; row < 8; row++) {
      const off = row % 2 === 0 ? 0 : -16;
      for (let x = off; x < S; x += 32) {
        const y = row * 32;
        ctx.fillStyle = `rgb(${132 + (rng() * 30) | 0},${118 + (rng() * 26) | 0},${88 + (rng() * 20) | 0})`;
        ctx.beginPath();
        ctx.ellipse(x + 16, y + 16, 17, 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(52,46,34,0.7)';
        ctx.stroke();
      }
    }
  } else if (style === 'plaster') {
    // exposed brick patches where plaster fell off
    for (let i = 0; i < 4; i++) {
      const x = rng() * S * 0.8, y = rng() * S * 0.8, w = 24 + rng() * 44, h = 20 + rng() * 36;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.fillStyle = '#7a5a48';
      ctx.fillRect(x, y, w, h);
      for (let by = y; by < y + h; by += 8) {
        for (let bx = x; bx < x + w; bx += 11) {
          ctx.fillStyle = `rgba(${96 + (rng() * 40) | 0},${64 + (rng() * 26) | 0},50,0.9)`;
          ctx.fillRect(bx, by, 9, 6);
        }
      }
      ctx.restore();
    }
  }

  windowsAndDoor(ctx, S, rng, style);

  // bottom weathering / mud splash
  const g = ctx.createLinearGradient(0, S * 0.72, 0, S);
  g.addColorStop(0, 'rgba(58,50,38,0)');
  g.addColorStop(1, 'rgba(58,50,38,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, S * 0.72, S, S * 0.28);

  return albedo(c, 1, 1);
}

export function roofTexture(): THREE.CanvasTexture {
  const S = 128;
  const [c, ctx] = makeCanvas(S, S);
  const rng = makeRng(141);
  ctx.fillStyle = '#5a5148';
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 16) {
    for (let x = 0; x < S; x += 12) {
      const off = (y / 16) % 2 === 0 ? 0 : 6;
      ctx.fillStyle = `rgb(${78 + (rng() * 26) | 0},${68 + (rng() * 22) | 0},${58 + (rng() * 20) | 0})`;
      ctx.fillRect(x + off, y, 10, 14);
      ctx.strokeStyle = 'rgba(30,28,24,0.7)';
      ctx.strokeRect(x + off, y, 10, 14);
    }
  }
  return albedo(c, 3, 3);
}

export function trackTexture(): THREE.CanvasTexture {
  const S = [128, 64] as const;
  const [c, ctx] = makeCanvas(S[0], S[1]);
  const rng = makeRng(3);
  ctx.fillStyle = '#1c1e21';
  ctx.fillRect(0, 0, S[0], S[1]);
  for (let x = 0; x < S[0]; x += 16) {
    // pad
    ctx.fillStyle = '#34383d';
    ctx.fillRect(x + 1, 3, 12, S[1] - 6);
    // pad ribs
    ctx.fillStyle = '#454a50';
    ctx.fillRect(x + 2, 6, 10, 5);
    ctx.fillRect(x + 2, S[1] - 11, 10, 5);
    // link pin
    ctx.fillStyle = '#141619';
    ctx.fillRect(x + 13, 0, 3, S[1]);
    // guide horn
    ctx.fillStyle = '#2a2e32';
    ctx.fillRect(x + 4, S[1] / 2 - 5, 8, 10);
    // mud in grooves
    if (rng() < 0.4) {
      ctx.fillStyle = 'rgba(96,82,54,0.4)';
      ctx.fillRect(x + 2, 10 + rng() * 30, 9, 6);
    }
  }
  return albedo(c, 1, 1);
}

// ---------------------------------------------------------------------------
// vegetation / particles / powerups
// ---------------------------------------------------------------------------

export function grassBladeTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const rng = makeRng(77);
  ctx.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 16; i++) {
    const x = 6 + rng() * 52;
    const h = 26 + rng() * 34;
    const lean = (rng() - 0.5) * 22;
    const g = 100 + rng() * 60;
    ctx.strokeStyle = `rgb(${(g * 0.5) | 0},${g | 0},${(g * 0.34) | 0})`;
    ctx.lineWidth = 2 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.quadraticCurveTo(x + lean * 0.4, 64 - h * 0.6, x + lean, 64 - h);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function softCircleTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smokePuffTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(96, 96);
  const rng = makeRng(55);
  for (let i = 0; i < 12; i++) {
    const x = 28 + rng() * 40, y = 28 + rng() * 40, r = 12 + rng() * 20;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 4-point star flash for muzzle blasts */
export function starFlashTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const cx = 64, cy = 64;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.6, 'rgba(255,190,90,0.55)');
  g.addColorStop(1, 'rgba(255,150,50,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(255,220,140,0.85)';
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * 62, cy + dy * 62);
    ctx.lineTo(cx + dy * 9 - dx * 6, cy + dx * 9 - dy * 6);
    ctx.lineTo(cx - dx * 10, cy - dy * 10);
    ctx.lineTo(cx + dy * 9 + dx * 6, cy + dx * 9 + dy * 6);
    ctx.closePath();
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function blobShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function iconTexture(kind: 'damage' | 'defense' | 'health' | 'invisibility', cssColor: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = cssColor;
  ctx.strokeStyle = cssColor;
  if (kind === 'damage') {
    ctx.beginPath();
    ctx.moveTo(32, 6); ctx.lineTo(56, 34); ctx.lineTo(42, 34); ctx.lineTo(42, 58);
    ctx.lineTo(22, 58); ctx.lineTo(22, 34); ctx.lineTo(8, 34);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'defense') {
    ctx.beginPath();
    ctx.moveTo(32, 4); ctx.lineTo(56, 14); ctx.lineTo(52, 40); ctx.lineTo(32, 60);
    ctx.lineTo(12, 40); ctx.lineTo(8, 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(10,12,16,0.55)';
    ctx.fillRect(28, 16, 8, 30);
  } else if (kind === 'health') {
    ctx.fillRect(25, 8, 14, 48);
    ctx.fillRect(8, 25, 48, 14);
  } else {
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.ellipse(32, 32, 24, 14, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(32, 32, 6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(10, 54); ctx.lineTo(54, 10); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function metalTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const rng = makeRng(99);
  ctx.fillStyle = '#7f868a';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = rng() > 0.5 ? 'rgba(40,46,50,0.14)' : 'rgba(180,186,190,0.12)';
    ctx.fillRect(rng() * 128, rng() * 128, 2 + rng() * 6, 2 + rng() * 3);
  }
  return albedo(c, 2, 2);
}
