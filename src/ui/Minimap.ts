/** Tactical minimap: pre-rendered terrain + live unit dots. */
import * as THREE from 'three';
import type { Tank } from '../tank/Tank';
import { heightAt, roadDistance } from '../world/Terrain';
import { MAP_SIZE, MAP_CONFIG } from '../config/map';
import { TEAMS } from '../config/match';
import type { PowerupId } from '../config/powerups';

const W = 200;

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private acc = 0;
  private cssColors: Record<PowerupId, string> = {
    damage: '#ff7a2a', defense: '#3aa0ff', health: '#5fd75f', invisibility: '#b05fff',
  };

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
    this.bg.width = W; this.bg.height = W;
    this.prerender();
  }

  private prerender(): void {
    const c = this.bg.getContext('2d')!;
    const step = 2;
    for (let py = 0; py < W; py += step) {
      for (let px = 0; px < W; px += step) {
        const x = (px / W) * MAP_SIZE - MAP_SIZE / 2;
        const z = MAP_SIZE / 2 - (py / W) * MAP_SIZE; // north up
        const h = heightAt(x, z);
        let col: string;
        if (h > 12) col = '#8a8574';
        else if (h > 7) col = '#6f6f4e';
        else if (h > 2.5) col = '#57603a';
        else col = '#46512f';
        if (roadDistance(x, z) < 5.5) col = '#6b5f43';
        c.fillStyle = col;
        c.fillRect(px, py, step, step);
      }
    }
    // buildings
    c.fillStyle = 'rgba(200, 205, 208, 0.85)';
    for (const b of MAP_CONFIG.buildings) {
      const px = ((b.x + MAP_SIZE / 2) / MAP_SIZE) * W;
      const py = ((MAP_SIZE / 2 - b.z) / MAP_SIZE) * W;
      const pw = (b.w / MAP_SIZE) * W;
      const ph = (b.d / MAP_SIZE) * W;
      c.fillRect(px - pw / 2, py - ph / 2, pw, ph);
    }
    // border
    c.strokeStyle = 'rgba(120,140,150,0.5)';
    c.strokeRect(0.5, 0.5, W - 1, W - 1);
  }

  update(dt: number, tanks: Tank[], player: Tank | null, powerups: { pos: THREE.Vector3; id: PowerupId }[]): void {
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(this.bg, 0, 0);

    // powerups
    for (const p of powerups) {
      const { x, y } = this.worldToMap(p.pos.x, p.pos.z);
      ctx.fillStyle = this.cssColors[p.id];
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.strokeRect(x - 2.5, y - 2.5, 5, 5);
    }

    // tanks
    for (const t of tanks) {
      if (!t.alive) continue;
      const { x, y } = this.worldToMap(t.pos.x, t.pos.z);
      const isPlayer = t === player;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t.yaw);
      ctx.fillStyle = isPlayer ? '#ffffff' : `#${new THREE.Color(TEAMS[t.team].color).getHexString()}`;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -4.5);
      ctx.lineTo(3.2, 3.5);
      ctx.lineTo(0, 1.8);
      ctx.lineTo(-3.2, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private worldToMap(x: number, z: number): { x: number; y: number } {
    return {
      x: ((x + MAP_SIZE / 2) / MAP_SIZE) * W,
      y: ((MAP_SIZE / 2 - z) / MAP_SIZE) * W,
    };
  }
}
