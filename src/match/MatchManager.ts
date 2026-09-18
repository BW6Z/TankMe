/**
 * Match orchestration: builds teams, spawns & respawns tanks, tracks score
 * and time, rotates team objectives, ends the battle and reports results.
 */
import * as THREE from 'three';
import { Tank } from '../tank/Tank';
import type { TankDeps } from '../tank/Tank';
import { TANKS } from '../config/tanks';
import type { TankSpec } from '../config/tanks';
import { MATCH_CONFIG, TEAMS, aiCallsign, roleMixFor } from '../config/match';
import type { MatchModeDef, TeamId } from '../config/match';
import { MAP_CONFIG } from '../config/map';
import { bus, EV } from '../core/Events';
import { AIController, pickTeamObjective } from '../controllers/AIController';
import type { AIRole, AIContext } from '../controllers/AIController';
import type { PlayerController } from '../controllers/PlayerController';
import type { PhysicsWorld } from '../world/Physics';
import type { NavGrid } from '../world/NavGrid';
import type { Effects } from '../effects/Effects';
import type { AudioManager } from '../audio/AudioManager';
import type { ProjectileSystem } from '../combat/Projectiles';
import type { PowerupSystem } from '../powerup/PowerupSystem';

export interface MatchDeps {
  scene: THREE.Scene;
  physics: PhysicsWorld;
  navgrid: NavGrid;
  effects: Effects;
  audio: AudioManager;
  projectiles: ProjectileSystem;
  powerups: PowerupSystem;
  coverPoints: THREE.Vector3[];
  playerController: PlayerController;
}

export interface ScoreboardRow {
  name: string; team: TeamId; tank: string; kills: number; deaths: number;
  damage: number; taken: number; isPlayer: boolean;
}

export class MatchManager {
  tanks: Tank[] = [];
  playerTank: Tank | null = null;
  scores: [number, number] = [0, 0];
  timeLeft = MATCH_CONFIG.duration;
  running = false;
  ended = false;
  winner: -1 | 0 | 1 = -1;
  mode: MatchModeDef;
  objectives: [THREE.Vector3, THREE.Vector3];

  private deps: MatchDeps;
  private tankDeps: TankDeps;
  private aiCtx: AIContext;
  private controllers: (AIController | PlayerController | null)[] = [];
  private objTimer = 25;
  private tickAcc = 0;
  private spawnCursor: [number, number] = [0, 0];
  private unsubDeath: () => void;

  constructor(deps: MatchDeps, mode: MatchModeDef) {
    this.deps = deps;
    this.mode = mode;
    this.objectives = [pickTeamObjective(0), pickTeamObjective(1)];

    this.tankDeps = {
      physics: deps.physics,
      spawnShell: (owner, muzzle, dir, mult) => deps.projectiles.spawn(owner, muzzle, dir, mult),
      muzzleFlash: (p, d, big) => deps.effects.muzzleFlash(p, d, big),
      explosion: (p, big) => deps.effects.explosion(p, big),
      hitFx: (p, n, k) => deps.effects.hitFx(p, n, k),
      tankSmoke: (p, heavy) => deps.effects.tankSmoke(p, heavy),
      pickupFx: (p, c) => deps.effects.powerupFx(p, c),
      exhaust: (p, i) => deps.effects.exhaust(p, i),
      addTrauma: (a) => deps.effects.addTrauma(a),
      playFire: (p, big) => deps.audio.fire(p, big),
      playExplosion: (p, big) => deps.audio.explosion(p, big),
      playHit: (p) => deps.audio.hit(p),
    };

    this.aiCtx = {
      physics: deps.physics,
      navgrid: deps.navgrid,
      tanks: this.tanks,
      teamObjective: (team) => this.objectives[team],
      coverPoints: deps.coverPoints,
      powerups: () => deps.powerups.list(),
    };

    this.unsubDeath = bus.on(EV.tankDeath, ({ victim, attacker }) => {
      if (attacker && attacker.team !== victim.team && this.running) {
        this.scores[attacker.team] += MATCH_CONFIG.killScore;
        bus.emit(EV.scoreChanged, { a: this.scores[0], b: this.scores[1] });
      }
    });
  }

  start(playerTankId: string): void {
    const size = this.mode.teamSize;
    for (let team = 0 as TeamId; team <= 1; team = (team + 1) as TeamId) {
      const aiCount = size - (team === 0 ? 1 : 0);
      const specs = this.classMix(aiCount);
      const roles = roleMixFor(size);
      for (let i = 0; i < size; i++) {
        const isPlayer = team === 0 && i === 0;
        const specIdx = isPlayer ? -1 : team === 0 ? i - 1 : i;
        const spec: TankSpec = isPlayer ? TANKS[playerTankId] : specs[specIdx];
        const name = isPlayer ? 'YOU' : aiCallsign(team, i + 1);
        const tank = new Tank(spec, team as TeamId, name, isPlayer, this.tankDeps);
        tank.nameColor = TEAMS[team].color;
        this.deps.scene.add(tank.visual.root);
        this.tanks.push(tank);
        if (isPlayer) {
          this.playerTank = tank;
          this.controllers.push(this.deps.playerController);
        } else {
          const roleIdx = team === 0 ? i - 1 : i;
          const role = roles[roleIdx % roles.length] as AIRole;
          const skill = 0.72 + Math.random() * 0.26;
          this.controllers.push(new AIController(tank, this.aiCtx, role, skill));
        }
        const sp = this.pickSpawn(team as TeamId, true);
        tank.spawnAt(sp.x + (Math.random() - 0.5) * 4, sp.z + (Math.random() - 0.5) * 4, sp.yaw);
      }
    }
    this.deps.projectiles.setTanksProvider(() => this.tanks);
    this.running = true;
    this.ended = false;
    this.timeLeft = MATCH_CONFIG.duration;
    bus.emit(EV.scoreChanged, { a: 0, b: 0 });
  }

  /** class distribution for AI teammates/opponents */
  private classMix(n: number): TankSpec[] {
    const light = Math.max(1, Math.round(n * 0.3));
    const heavy = Math.max(0, Math.round(n * 0.2));
    const medium = n - light - heavy;
    const arr: TankSpec[] = [];
    const push = (id: string, c: number) => { for (let i = 0; i < c; i++) arr.push(TANKS[id]); };
    push('jackal', light);
    push('vanguard', medium);
    push('colossus', heavy);
    // shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private pickSpawn(team: TeamId, initial: boolean): { x: number; z: number; yaw: number } {
    const pts = MAP_CONFIG.spawns[team].points;
    if (initial) {
      const p = pts[this.spawnCursor[team] % pts.length];
      this.spawnCursor[team] = (this.spawnCursor[team] + 1) % pts.length;
      return p;
    }
    let best = pts[0];
    let bestScore = -Infinity;
    for (const p of pts) {
      // never respawn onto a living teammate
      let tooClose = false;
      for (const t of this.tanks) {
        if (!t.alive || t.team !== team) continue;
        const ddx = p.x - t.pos.x, ddz = p.z - t.pos.z;
        if (ddx * ddx + ddz * ddz < 110) { tooClose = true; break; }
      }
      if (tooClose) continue;
      let minD = Infinity;
      for (const t of this.tanks) {
        if (!t.alive || t.team === team) continue;
        const d = (p.x - t.pos.x) * (p.x - t.pos.x) + (p.z - t.pos.z) * (p.z - t.pos.z);
        if (d < minD) minD = d;
      }
      const score = (this.tanks.some((t) => t.alive && t.team !== team) ? minD : 0) + Math.random() * 400;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  update(dt: number): void {
    if (!this.running) return;

    this.timeLeft -= dt;
    this.tickAcc += dt;
    if (this.tickAcc >= 1) {
      this.tickAcc -= 1;
      bus.emit(EV.matchTick, { timeLeft: Math.max(0, Math.ceil(this.timeLeft)) });
    }

    this.objTimer -= dt;
    if (this.objTimer <= 0) {
      this.objTimer = 40;
      this.objectives[0] = pickTeamObjective(0);
      this.objectives[1] = pickTeamObjective(1);
    }

    // controllers first (player controller reads camera aim already updated by Game)
    for (let i = 0; i < this.tanks.length; i++) {
      const c = this.controllers[i];
      if (c) c.update(dt, this.tanks[i]);
    }
    // tank simulation
    for (const t of this.tanks) t.update(dt, this.tanks);
    // projectile flight & hits
    this.deps.projectiles.update(dt);
    // respawns
    for (const t of this.tanks) {
      if (!t.alive && t.respawnTimer <= 0) {
        const sp = this.pickSpawn(t.team, false);
        t.spawnAt(sp.x, sp.z, sp.yaw);
        this.deps.effects.respawnFx(t.pos);
      }
    }
    this.deps.powerups.update(dt, this.tanks);

    // win conditions
    for (const team of [0, 1] as TeamId[]) {
      if (this.scores[team] >= this.mode.scoreLimit) { this.end(team); return; }
    }
    if (this.timeLeft <= 0) {
      if (this.scores[0] > this.scores[1]) this.end(0);
      else if (this.scores[1] > this.scores[0]) this.end(1);
      else this.end(-1);
    }
  }

  private end(winner: -1 | 0 | 1): void {
    if (this.ended) return;
    this.running = false;
    this.ended = true;
    this.winner = winner;
    const rows: ScoreboardRow[] = this.tanks.map((t) => ({
      name: t.name, team: t.team, tank: t.spec.name,
      kills: t.stats.kills, deaths: t.stats.deaths,
      damage: Math.round(t.stats.damageDealt), taken: Math.round(t.stats.damageTaken),
      isPlayer: t.isPlayer,
    })).sort((a, b) => b.kills - a.kills || b.damage - a.damage);
    bus.emit(EV.matchEnd, {
      winner,
      scores: [this.scores[0], this.scores[1]],
      mode: this.mode,
      elapsed: MATCH_CONFIG.duration - Math.max(0, this.timeLeft),
      rows,
      player: this.playerTank ? {
        kills: this.playerTank.stats.kills,
        deaths: this.playerTank.stats.deaths,
        damage: Math.round(this.playerTank.stats.damageDealt),
        taken: Math.round(this.playerTank.stats.damageTaken),
        shots: this.playerTank.stats.shots,
        hits: this.playerTank.stats.hits,
      } : null,
    });
  }

  dispose(): void {
    this.running = false;
    this.unsubDeath();
    for (const t of this.tanks) t.visual.dispose(this.deps.scene);
    this.tanks.length = 0;
    this.controllers.length = 0;
    this.playerTank = null;
    this.deps.powerups.clear();
    this.deps.projectiles.clear();
  }
}
