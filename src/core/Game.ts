/**
 * Top-level orchestrator: boot sequence, screen state machine, main loop,
 * event wiring between simulation, effects, audio and UI.
 */
import * as THREE from 'three';
import { GameScene } from '../render/SceneSetup';
import { PhysicsWorld } from '../world/Physics';
import { NavGrid } from '../world/NavGrid';
import { buildMap } from '../world/MapBuilder';
import { Effects } from '../effects/Effects';
import { AudioManager } from '../audio/AudioManager';
import { ProjectileSystem } from '../combat/Projectiles';
import { PowerupSystem } from '../powerup/PowerupSystem';
import { CameraRig } from '../camera/CameraRig';
import { Input } from './Input';
import { Settings } from './Settings';
import { UI } from '../ui/UI';
import { Minimap } from '../ui/Minimap';
import { MatchManager } from '../match/MatchManager';
import { PlayerController } from '../controllers/PlayerController';
import { TankVisual } from '../tank/TankModel';
import { TANKS } from '../config/tanks';
import { QUALITY_PRESETS } from '../config/quality';
import { MATCH_MODES } from '../config/match';
import { bus, EV } from './Events';
import { verdictLabel } from '../combat/ArmorMath';
import { t as tt } from './i18n';
import { POWERUPS } from '../config/powerups';
import { MAP_CONFIG } from '../config/map';
import { heightAt } from '../world/Terrain';
import { t, initLocale } from './i18n';

type State = 'boot' | 'menu' | 'battle' | 'paused' | 'results';

export class Game {
  private settings = new Settings();
  private ui!: UI;
  private input!: Input;
  private sceneSetup!: GameScene;
  private physics = new PhysicsWorld();
  private navgrid!: NavGrid;
  private effects!: Effects;
  private audio = new AudioManager();
  private projectiles!: ProjectileSystem;
  private powerups!: PowerupSystem;
  private cameraRig!: CameraRig;
  private playerController!: PlayerController;
  private minimap!: Minimap;
  private match: MatchManager | null = null;

  private state: State = 'boot';
  private hadPointerLock = false;
  private windUniform = { value: 0 };
  private showroom = { x: -20, z: -30 };
  private displayTank: TankVisual | null = null;
  private lastT = 0;
  private fpsSmooth = 60;
  private prevReload = 0;
  private canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    void this.boot();
  }

  private async boot(): Promise<void> {
    this.settings.load();
    initLocale(this.settings);

    this.ui = new UI(this.settings, {
      startBattle: (mode, tank) => this.startBattle(mode, tank),
      rematch: () => this.startBattle(this.settings.data.lastMode, this.settings.data.lastTank),
      leaveBattle: () => this.leaveBattle(),
      resume: () => this.resumeBattle(),
      previewTank: (id) => this.setDisplayTank(id),
      qualityChanged: (q) => {
        this.sceneSetup.applyQuality(QUALITY_PRESETS[q]);
        this.effects.setQualityScale(QUALITY_PRESETS[q].particleScale);
      },
    });
    this.input = new Input(this.canvas);
    this.ui.loading(0.1, t('load-igniting'));
    await frame();

    this.sceneSetup = new GameScene(this.canvas, QUALITY_PRESETS[this.settings.data.quality]);
    this.ui.loading(0.25, t('load-terrain'));
    await frame();

    const mapData = buildMap(this.sceneSetup.scene, this.physics);
    this.coverPoints = mapData.coverPoints;
    this.windUniform = mapData.windUniform;
    this.showroom = mapData.showroom;
    this.ui.loading(0.55, t('load-navgrid'));
    await frame();

    this.navgrid = new NavGrid(this.physics);
    this.navgrid.build();
    this.ui.loading(0.7, t('load-ammo'));
    await frame();

    const numsLayer = document.getElementById('dmg-layer')!;
    this.effects = new Effects(this.sceneSetup.scene, numsLayer);
    this.effects.setQualityScale(QUALITY_PRESETS[this.settings.data.quality].particleScale);
    this.projectiles = new ProjectileSystem(this.sceneSetup.scene, this.physics, this.effects);
    this.powerups = new PowerupSystem(this.sceneSetup.scene, this.effects);
    this.cameraRig = new CameraRig(
      () => window.innerWidth / Math.max(1, window.innerHeight),
      this.physics, this.input, this.effects, this.settings,
    );
    this.effects.attachCamera(this.cameraRig.camera);
    this.sceneSetup.attachCamera(this.cameraRig.camera);
    this.setDisplayTank(this.settings.data.lastTank);
    this.playerController = new PlayerController(this.input, this.cameraRig);
    this.minimap = new Minimap(document.getElementById('minimap') as HTMLCanvasElement);
    this.ui.loading(0.9, t('load-tanks'));
    await frame();

    this.wireEvents();
    window.addEventListener('resize', this.resizeViewport);
    // WebGL canvases start with a 300x150 drawing buffer. Synchronize it with
    // the CSS viewport before the first rendered frame instead of waiting for
    // the user to resize the browser window.
    this.resizeViewport();
    document.addEventListener('pointerlockchange', () => {
      if (this.input.locked) {
        this.hadPointerLock = true;
      } else if (this.hadPointerLock && this.state === 'battle') {
        // real lock loss (Esc) during play → pause; never locked → don't pause
        this.pauseBattle();
      }
    });

    (window as any).__tankme = { game: this };
    this.ui.loading(1, t('load-ready'));
    this.state = 'menu';
    this.ui.show('menu');
    this.audio.ensure();
    this.lastT = performance.now();
    requestAnimationFrame(this.tick);
  }

  /** Keep the renderer/composer drawing buffers and camera projection aligned. */
  private readonly resizeViewport = (): void => {
    this.sceneSetup.resize();
    this.cameraRig.resize(window.innerWidth / Math.max(1, window.innerHeight));
  };

  // ---------------- event wiring ----------------

  private wireEvents(): void {
    bus.on(EV.armorPenetrated, ({ shooter, victim, amount, crit, module, point }: any) => {
      if (shooter?.isPlayer && amount > 0) {
        this.ui.hitmarker(crit);
        this.ui.combatFeedback(
          t('cf-pen', { n: Math.round(amount) }),
          crit ? 'crit' : 'good',
        );
        this.effects.floatDamage(point, amount, crit ? 'crit' : 'normal');
        this.audio.hit(point);
      }
      if (victim.isPlayer) {
        this.ui.addVignette(0.5);
        this.audio.hit(point);
        if (shooter) {
          // direction of incoming fire relative to camera
          const dir = _v1.subVectors(shooter.pos, victim.pos);
          const worldAngle = Math.atan2(dir.x, dir.z);
          const camDir = _v2.set(0, 0, 0);
          this.cameraRig.camera.getWorldDirection(camDir);
          const camAngle = Math.atan2(camDir.x, camDir.z);
          this.ui.damageDirection(worldAngle - camAngle + Math.PI);
        }
      }
    });

    bus.on(EV.armorBlocked, ({ shooter, victim, reason }: any) => {
      if (shooter?.isPlayer) {
        this.ui.hitmarker(false);
        this.ui.combatFeedback(reason === 'ricochet' ? t('cf-ricochet') : t('cf-no-pen'), 'block');
      }
      if (victim.isPlayer && shooter) {
        this.ui.combatFeedback(reason === 'ricochet' ? t('cf-ricochet-self') : t('cf-blocked'), 'good');
      }
    });

    bus.on(EV.criticalHit, ({ shooter, module }: any) => {
      if (shooter?.isPlayer && module) this.ui.combatFeedback(t('cf-crit'), 'crit');
    });

    bus.on(EV.moduleDamaged, ({ tank, module }: any) => {
      if (tank.isPlayer) this.ui.combatFeedback(t('cf-module', { m: t(`mod-${module}`).split(' ')[0] }), 'bad');
    });

    bus.on(EV.tankDeath, ({ victim, attacker }: any) => {
      this.ui.killfeed(
        attacker ? attacker.name : 'Battlefield',
        attacker ? attacker.team : (1 - victim.team),
        victim.name, victim.team,
      );
      // center-screen kill message for the player's own kills
      if (attacker?.isPlayer && victim.team !== attacker.team) {
        this.ui.killMessage(t('kill-enemy'), victim.name);
      }
      const player = this.match?.playerTank;
      if (player) {
        const d = player.pos.distanceTo(victim.pos);
        this.effects.addTrauma(Math.max(0, 1 - d / 70) * 0.55);
      }
    });

    bus.on(EV.powerupPickup, ({ tank, def }: any) => {
      if (tank.isPlayer) {
        this.ui.pickupToast(def);
        this.audio.powerup();
      }
    });

    bus.on(EV.matchEnd, (payload: any) => {
      this.state = 'results';
      this.input.exitLock();
      this.ui.show('results');
      this.ui.showResults(payload);
      this.audio.engine(0, false);
      if (payload.winner === 0) this.audio.victory();
      else if (payload.winner === 1) this.audio.defeat();
      this.settings.save();
    });
  }

  // ---------------- match lifecycle ----------------

  private startBattle(modeId: string, tankId: string): void {
    this.audio.ensure();
    if (this.match) { this.match.dispose(); this.match = null; }
    const mode = MATCH_MODES.find((m) => m.id === modeId) ?? MATCH_MODES[0];
    this.match = new MatchManager({
      scene: this.sceneSetup.scene,
      physics: this.physics,
      navgrid: this.navgrid,
      effects: this.effects,
      audio: this.audio,
      projectiles: this.projectiles,
      powerups: this.powerups,
      coverPoints: this.coverPoints,
      playerController: this.playerController,
    }, mode);
    this.match.start(tankId);
    this.cameraRig.tanksProvider = () => this.match!.tanks;

    this.state = 'battle';
    this.ui.show('battle');
    this.ui.resetHud();
    this.ui.banner(t('load-map'), t('banner-sub', { mode: t(mode.id === '7v7' ? 'mode-7v7' : 'mode-14v14'), n: mode.scoreLimit }));
    this.audio.battleStart();
    this.input.requestLock();
    this.prevReload = 0;
    this.hideDisplayTank();
  }

  private pauseBattle(): void {
    if (this.state !== 'battle') return;
    this.state = 'paused';
    this.input.exitLock();
    this.ui.show('pause');
    const player = this.match?.playerTank;
    if (player) this.audio.engine(0, false);
  }

  private resumeBattle(): void {
    if (this.state !== 'paused') return;
    this.state = 'battle';
    this.ui.show('battle');
    this.input.requestLock();
  }

  private leaveBattle(): void {
    if (this.match) { this.match.dispose(); this.match = null; }
    this.audio.engine(0, false);
    this.input.exitLock();
    this.state = 'menu';
    this.ui.show('menu');
    this.setDisplayTank(this.settings.data.lastTank);
  }

  // ---------------- main loop ----------------

  private tick = (t: number): void => {
    requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, Math.max(0.001, (t - this.lastT) / 1000));
    this.lastT = t;
    this.fpsSmooth = this.fpsSmooth * 0.95 + (1 / dt) * 0.05;

    if (this.state === 'battle' && this.match) {
      this.updateBattle(dt);
    } else if (this.state !== 'paused') {
      // menu-family screens: cinematic showroom orbit
      this.cameraRig.updateShowroom(dt, this.showroom);
      this.windUniform.value += dt;
      if (this.displayTank) this.displayTank.root.rotation.y += dt * 0.3;
      this.effects.update(dt);
      _sunFocus.set(this.showroom.x, 0, this.showroom.z);
      this.sceneSetup.updateSunTarget(_sunFocus);
    }

    this.sceneSetup.render(this.cameraRig.camera);
    if (this.settings.data.showFps) this.ui.fps(this.fpsSmooth);
    this.input.endFrame();
  };

  private updateBattle(dt: number): void {
    const match = this.match!;
    const player = match.playerTank;

    // camera first so controllers read a fresh aim point
    if (player && player.alive) {
      this.cameraRig.updateBattle(dt, player);
    } else if (player) {
      // death cam: slow orbit around wreck
      this.cameraRig.yaw += dt * 0.25;
      this.cameraRig.updateBattle(0.0001, player);
    }

    match.update(dt);
    this.effects.update(dt);

    // track dust for moving tanks near camera
    const cam = this.cameraRig.camera.position;
    for (const t of match.tanks) {
      if (!t.alive || Math.abs(t.speed) < 3.5) continue;
      if (t.pos.distanceToSquared(cam) > 90 * 90) continue;
      this.effects.trackDust(t.pos, 0.6);
    }

    // audio
    const camDir = _v2.set(0, 0, -1).applyQuaternion(this.cameraRig.camera.quaternion);
    const right = _v1.set(1, 0, 0).applyQuaternion(this.cameraRig.camera.quaternion);
    this.audio.setListener(cam, right);
    if (player) {
      this.audio.engine(Math.min(1, Math.abs(player.speed) / player.spec.mobility.maxSpeed), player.alive && this.state === 'battle');
      // reload-complete click
      if (this.prevReload > 0 && player.reloadLeft <= 0 && player.alive) this.audio.reloadDone();
      this.prevReload = player.reloadLeft;
    }

    this.sceneSetup.updateSunTarget(player ? player.pos : cam);

    // HUD
    if (player) {
      // dynamic crosshair spread + gun alignment marker
      const speedFrac = Math.min(1, Math.abs(player.speed) / player.spec.mobility.maxSpeed);
      const spread = Math.min(1, speedFrac * 0.8 + (player.reloadLeft > 0 && player.reloadLeft < 1 ? 0.35 : 0));
      let gunMarker: { x: number; y: number; behind: boolean } | null = null;
      if (player.alive) {
        const mp = _v3.set(0, 0, 0);
        player.visual.muzzle.getWorldPosition(mp);
        const dir = _v1.set(
          Math.sin(player.turretYaw) * Math.cos(player.barrelPitch),
          Math.sin(player.barrelPitch),
          Math.cos(player.turretYaw) * Math.cos(player.barrelPitch),
        );
        mp.addScaledVector(dir, 28);
        mp.project(this.cameraRig.camera);
        gunMarker = { x: mp.x * 0.5 + 0.5, y: -mp.y * 0.5 + 0.5, behind: mp.z > 1 };
      }
      const at = this.cameraRig.aimedTarget;
      const az = this.cameraRig.aimAnalysis;
      const VERDICT_COLOR: Record<string, string> = {
        green: '#7ce06a', yellow: '#e8d24a', orange: '#f09030', red: '#ff4d3d',
      };
      const aimTarget = at && at.tank.team !== player.team && player.alive
        ? {
            name: at.tank.name, hp: at.tank.hp, maxHp: at.tank.spec.maxHp, dist: at.dist,
            zone: az ? az.zoneLabel : '',
          }
        : null;
      const armorViz = az && at && at.tank.team !== player.team && player.alive
        ? {
            color: VERDICT_COLOR[az.verdict],
            label: tt(`verdict-${az.verdict}`),
            zone: tt(`zone-${az.zone}`),
            eff: az.effArmor,
          }
        : null;
      this.ui.hudFrame(dt, {
        spec: player.spec,
        hp: player.hp,
        maxHp: player.spec.maxHp,
        reloadFrac: player.alive ? 1 - Math.max(0, player.reloadLeft) / player.spec.gun.reload : 0,
        reloadLeft: Math.max(0, player.reloadLeft),
        zoomed: this.cameraRig.zoomFrac > 0.5,
        speedKmh: Math.abs(player.speed) * 3.6,
        spread,
        buffs: [...player.buffs.entries()].map(([id, time]) => ({
          id, time, def: POWERUPS.find((d) => d.id === id)!,
        })),
        modules: (['track', 'engine', 'gun'] as const).filter((m) => player.modules[m] > 0),
        scoreA: match.scores[0],
        scoreB: match.scores[1],
        timeLeft: match.timeLeft,
        alive: player.alive,
        respawnTimer: player.respawnTimer,
        killedBy: player.killedBy,
        gunMarker,
        aimTarget,
        armorViz,
      });
    }
    this.minimap.update(dt, match.tanks, player, this.powerups.list());
  }

  private coverPoints: THREE.Vector3[] = [];

  private setDisplayTank(tankId: string): void {
    if (this.displayTank) {
      this.displayTank.dispose(this.sceneSetup.scene);
      this.displayTank = null;
    }
    // showroom fill light — only lives while the display vehicle does
    if (!this.showroomLight) {
      this.showroomLight = new THREE.PointLight(0xfff0d0, 60, 34, 1.6);
      this.showroomLight.position.set(this.showroom.x, heightAt(this.showroom.x, this.showroom.z) + 7.5, this.showroom.z);
      this.sceneSetup.scene.add(this.showroomLight);
    }
    this.showroomLight.visible = true;
    const spec = TANKS[tankId];
    if (!spec) return;
    const v = new TankVisual(spec, 0xd8a03a, '', { nameplate: false });
    v.root.position.set(this.showroom.x, heightAt(this.showroom.x, this.showroom.z) + 0.62, this.showroom.z);
    this.sceneSetup.scene.add(v.root);
    this.displayTank = v;
  }

  private hideDisplayTank(): void {
    if (this.displayTank) {
      this.displayTank.dispose(this.sceneSetup.scene);
      this.displayTank = null;
    }
    if (this.showroomLight) this.showroomLight.visible = false;
  }

  private showroomLight: THREE.PointLight | null = null;

  /** debug/testing hook: render one frame and return it as a JPEG data URL */
  debugFrame(quality = 0.6): string {
    this.sceneSetup.render(this.cameraRig.camera);
    return this.sceneSetup.renderer.domElement.toDataURL('image/jpeg', quality);
  }

  /** debug hook: resume battle without pointer lock (test environments) */
  debugResume(): void {
    if (this.state === 'paused' || this.state === 'battle') {
      this.state = 'battle';
      this.ui.show('battle');
    }
  }

  /** debug hook: inject key/button input */
  debugInput(kind: 'key' | 'button', code: string | number, down: boolean): void {
    if (kind === 'key') this.input.setKey(String(code), down);
    else this.input.setButton(Number(code), down);
  }

  /** debug/testing hook: click a menu button programmatically */
  debugClick(elementId: string): void {
    (document.getElementById(elementId) as HTMLElement | null)?.click();
  }

  debugState(): any {
    const m = this.match;
    return {
      state: this.state,
      fps: Math.round(this.fpsSmooth),
      scores: m ? m.scores : null,
      timeLeft: m ? Math.ceil(m.timeLeft) : null,
      player: m?.playerTank ? {
        pos: m.playerTank.pos.toArray().map((v) => Math.round(v * 10) / 10),
        hp: Math.round(m.playerTank.hp),
        alive: m.playerTank.alive,
        speed: Math.round(m.playerTank.speed * 10) / 10,
        turretYaw: Math.round(m.playerTank.turretYaw * 100) / 100,
      } : null,
      tanksAlive: m ? m.tanks.filter((t) => t.alive).length : 0,
    };
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _sunFocus = new THREE.Vector3();

/** boot step delay — setTimeout so hidden tabs still finish booting */
function frame(): Promise<void> {
  return new Promise((r) => setTimeout(r, 24));
}
