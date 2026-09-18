/**
 * Procedural textures — every texture in the game is generated at runtime,
 * no external assets, guaranteed original.
 */
import * as THREE from 'three';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rand(seed: { v: number }): number {
  // deterministic-ish mulberry noise
  seed.v = (seed.v * 1664525 + 1013904223) >>> 0;
  return seed.v / 4294967296;
}

export function groundTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(512, 512);
  const seed = { v: 7 };
  ctx.fillStyle = '#66713f';
  ctx.fillRect(0, 0, 512, 512);
  // patchy grass/dirt
  for (let i = 0; i < 900; i++) {
    const x = rand(seed) * 512, y = rand(seed) * 512;
    const r = 6 + rand(seed) * 34;
    const g = rand(seed);
    const col = g < 0.42 ? '#5d6b3a' : g < 0.7 ? '#6e7a45' : g < 0.88 ? '#77704a' : '#8a7f55';
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.25 + rand(seed) * 0.3;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rand(seed) * 0.7), rand(seed) * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // speckle
  ctx.globalAlpha = 1;
  for (let i = 0; i < 4000; i++) {
    const x = rand(seed) * 512, y = rand(seed) * 512;
    ctx.fillStyle = rand(seed) > 0.5 ? 'rgba(40,48,26,0.25)' : 'rgba(150,150,110,0.18)';
    ctx.fillRect(x, y, 2, 2);
  }
  return toTexture(c, 44, 44);
}

export function roadTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  const seed = { v: 31 };
  ctx.fillStyle = '#7a6f52';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 350; i++) {
    const x = rand(seed) * 256, y = rand(seed) * 256, r = 4 + rand(seed) * 20;
    ctx.fillStyle = rand(seed) > 0.5 ? '#6e6349' : '#867a5c';
    ctx.globalAlpha = 0.3 + rand(seed) * 0.3;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  // wheel ruts along V axis
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#5f563e';
  ctx.fillRect(64, 0, 22, 256);
  ctx.fillRect(170, 0, 22, 256);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 1500; i++) {
    ctx.fillStyle = rand(seed) > 0.5 ? 'rgba(50,44,30,0.3)' : 'rgba(160,150,115,0.25)';
    ctx.fillRect(rand(seed) * 256, rand(seed) * 256, 2, 2);
  }
  return toTexture(c, 1, 24);
}

export function trackTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 64);
  const seed = { v: 3 };
  ctx.fillStyle = '#23262a';
  ctx.fillRect(0, 0, 128, 64);
  // tread links
  for (let x = 0; x < 128; x += 16) {
    ctx.fillStyle = '#3a4046';
    ctx.fillRect(x, 2, 11, 60);
    ctx.fillStyle = '#171a1d';
    ctx.fillRect(x + 11, 2, 5, 60);
    // guide horns
    ctx.fillStyle = '#4a5258';
    ctx.fillRect(x + 3, 26, 6, 12);
  }
  // wear speckle
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = rand(seed) > 0.5 ? 'rgba(90,95,100,0.2)' : 'rgba(10,10,12,0.3)';
    ctx.fillRect(rand(seed) * 128, rand(seed) * 64, 2, 2);
  }
  return toTexture(c, 1, 1);
}

export function buildingTexture(style: 'brick' | 'concrete' | 'barn'): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  const seed = { v: style === 'brick' ? 11 : style === 'concrete' ? 23 : 41 };
  if (style === 'brick') {
    ctx.fillStyle = '#8a6f5a';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 14) {
      for (let x = (y / 14) % 2 === 0 ? 0 : -9; x < 256; x += 18) {
        ctx.fillStyle = `rgb(${120 + (rand(seed) * 40) | 0},${86 + (rand(seed) * 30) | 0},${66 + (rand(seed) * 24) | 0})`;
        ctx.fillRect(x + 1, y + 1, 16, 12);
      }
    }
  } else if (style === 'concrete') {
    ctx.fillStyle = '#9aa0a2';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = rand(seed) > 0.5 ? 'rgba(60,66,70,0.12)' : 'rgba(200,205,208,0.14)';
      ctx.fillRect(rand(seed) * 256, rand(seed) * 256, 3 + rand(seed) * 10, 3 + rand(seed) * 8);
    }
    // stains
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = 'rgba(70,75,72,0.14)';
      ctx.fillRect(rand(seed) * 256, rand(seed) * 256, 8 + rand(seed) * 40, 20 + rand(seed) * 80);
    }
  } else {
    // barn: vertical planks
    ctx.fillStyle = '#7d6b4a';
    ctx.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      ctx.fillStyle = `rgb(${105 + (rand(seed) * 34) | 0},${90 + (rand(seed) * 26) | 0},${60 + (rand(seed) * 20) | 0})`;
      ctx.fillRect(x, 0, 14, 256);
      ctx.fillStyle = 'rgba(40,32,18,0.5)';
      ctx.fillRect(x + 14, 0, 2, 256);
    }
  }
  // windows grid (not for barn sides handled by caller choice)
  if (style !== 'barn') {
    for (let wy = 36; wy < 220; wy += 64) {
      for (let wx = 28; wx < 230; wx += 56) {
        ctx.fillStyle = '#2b3238';
        ctx.fillRect(wx, wy, 24, 30);
        ctx.fillStyle = 'rgba(140,170,190,0.25)';
        ctx.fillRect(wx + 2, wy + 2, 20, 12);
        ctx.strokeStyle = 'rgba(30,34,38,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(wx, wy, 24, 30);
      }
    }
  } else {
    // barn door + small window
    ctx.fillStyle = '#4a3d28';
    ctx.fillRect(96, 120, 64, 136);
    ctx.fillStyle = '#2b3238';
    ctx.fillRect(30, 60, 30, 24);
    ctx.fillRect(196, 60, 30, 24);
  }
  return toTexture(c, 1, 1);
}

export function metalTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const seed = { v: 99 };
  ctx.fillStyle = '#7f868a';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = rand(seed) > 0.5 ? 'rgba(40,46,50,0.14)' : 'rgba(180,186,190,0.12)';
    ctx.fillRect(rand(seed) * 128, rand(seed) * 128, 2 + rand(seed) * 6, 2 + rand(seed) * 3);
  }
  return toTexture(c, 2, 2);
}

export function softCircleTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function smokePuffTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(96, 96);
  const seed = { v: 55 };
  // blobby smoke: several overlapping soft circles
  for (let i = 0; i < 10; i++) {
    const x = 30 + rand(seed) * 36, y = 30 + rand(seed) * 36, r = 12 + rand(seed) * 18;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function crateTexture(color: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#22262a';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.28;
  ctx.fillRect(0, 0, 128, 128);
  ctx.globalAlpha = 1;
  // frame
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 116, 116);
  // hazard stripes on band
  ctx.fillStyle = color;
  ctx.fillRect(6, 52, 116, 24);
  ctx.fillStyle = 'rgba(10,12,14,0.85)';
  for (let x = 6; x < 128; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 76); ctx.lineTo(x + 8, 76); ctx.lineTo(x + 16, 52); ctx.lineTo(x + 8, 52);
    ctx.closePath(); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function iconTexture(kind: 'damage' | 'defense' | 'health' | 'invisibility', cssColor: string): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = cssColor;
  ctx.strokeStyle = cssColor;
  if (kind === 'damage') {
    // upward chevron / shell burst
    ctx.beginPath();
    ctx.moveTo(32, 6); ctx.lineTo(56, 34); ctx.lineTo(42, 34); ctx.lineTo(42, 58);
    ctx.lineTo(22, 58); ctx.lineTo(22, 34); ctx.lineTo(8, 34);
    ctx.closePath(); ctx.fill();
  } else if (kind === 'defense') {
    // shield
    ctx.beginPath();
    ctx.moveTo(32, 4); ctx.lineTo(56, 14); ctx.lineTo(52, 40); ctx.lineTo(32, 60);
    ctx.lineTo(12, 40); ctx.lineTo(8, 14);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(10,12,16,0.55)';
    ctx.fillRect(28, 16, 8, 30);
  } else if (kind === 'health') {
    // cross
    ctx.fillRect(25, 8, 14, 48);
    ctx.fillRect(8, 25, 48, 14);
  } else {
    // cloak: eye with slash
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
