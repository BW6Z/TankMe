/** All DOM UI: menus, deploy, settings, HUD, pause, results. */
import { MATCH_MODES, TEAMS } from '../config/match';
import type { MatchModeDef } from '../config/match';
import { TANKS, TANK_IDS, tankRatings } from '../config/tanks';
import type { TankSpec } from '../config/tanks';
import { POWERUPS } from '../config/powerups';
import type { PowerupDef, PowerupId } from '../config/powerups';
import type { QualityLevel } from '../config/quality';
import { QUALITY_PRESETS } from '../config/quality';
import type { Settings } from '../core/Settings';
import type { ScoreboardRow } from '../match/MatchManager';
import { MATCH_CONFIG } from '../config/match';

export interface UICallbacks {
  startBattle(modeId: string, tankId: string): void;
  rematch(): void;
  leaveBattle(): void;
  resume(): void;
  qualityChanged(q: QualityLevel): void;
}

type ScreenName = 'loading' | 'menu' | 'deploy' | 'settings' | 'howto' | 'battle' | 'pause' | 'results';

function id<T extends HTMLElement = HTMLElement>(name: string): T {
  const el = document.getElementById(name);
  if (!el) throw new Error(`Missing UI element #${name}`);
  return el as T;
}

export class UI {
  private screens: Record<ScreenName, HTMLElement>;
  private settingsReturn: 'menu' | 'pause' | 'deploy' = 'menu';
  private selectedMode: MatchModeDef;
  private selectedTank: string;
  private hintTimer = 0;
  private buffAcc = 0;
  private lastBuffKey = '';
  private vignetteLevel = 0;
  private bannerTimeout: number | undefined;

  // HUD element refs
  private hpFill = id<HTMLDivElement>('hp-fill');
  private hpNum = id<HTMLDivElement>('hp-num');
  private tankName = id<HTMLDivElement>('hud-tank-name');
  private reloadRing = id<HTMLDivElement>('reload-ring');
  private reloadText = id<HTMLDivElement>('reload-text');
  private crosshair = id<HTMLDivElement>('crosshair');
  private hitmarkerEl = id<HTMLDivElement>('hitmarker');
  private dmgDir = id<HTMLDivElement>('dmg-dir');
  private scoreA = id<HTMLSpanElement>('score-a');
  private scoreB = id<HTMLSpanElement>('score-b');
  private matchTimer = id<HTMLDivElement>('match-timer');
  private killfeedEl = id<HTMLDivElement>('killfeed');
  private buffBar = id<HTMLDivElement>('buff-bar');
  private speedHud = id<HTMLDivElement>('speed-hud');
  private fpsCounter = id<HTMLDivElement>('fps-counter');
  private vignetteDamage = id<HTMLDivElement>('vignette-damage');
  private vignetteLowHp = id<HTMLDivElement>('vignette-lowhp');
  private pickupBanner = id<HTMLDivElement>('pickup-banner');
  private respawnOverlay = id<HTMLDivElement>('respawn-overlay');
  private respawnKiller = id<HTMLDivElement>('respawn-killer');
  private respawnCount = id<HTMLSpanElement>('respawn-count');
  private battleBanner = id<HTMLDivElement>('battle-banner');
  private controlsHint = id<HTMLDivElement>('controls-hint');

  private hitmarkerTimeout: number | undefined;
  private dirTimeout: number | undefined;

  constructor(
    private settings: Settings,
    private cb: UICallbacks,
  ) {
    this.screens = {
      loading: id('loading-screen'),
      menu: id('menu-screen'),
      deploy: id('deploy-screen'),
      settings: id('settings-screen'),
      howto: id('howto-screen'),
      battle: id('hud'),
      pause: id('pause-screen'),
      results: id('results-screen'),
    };
    this.selectedMode = MATCH_MODES.find((m) => m.id === settings.data.lastMode) ?? MATCH_MODES[0];
    this.selectedTank = settings.data.lastTank in TANKS ? settings.data.lastTank : 'vanguard';
    this.wireMenus();
    this.buildDeploy();
    this.buildSettings();
    id('team-a-label').textContent = TEAMS[0].name;
    id('team-b-label').textContent = TEAMS[1].name;
    id('results-team-a').textContent = TEAMS[0].name;
    id('results-team-b').textContent = TEAMS[1].name;
  }

  // ---------------- screens ----------------

  show(screen: ScreenName): void {
    const base: ScreenName[] = ['loading', 'menu', 'deploy', 'battle'];
    for (const name of base) {
      this.screens[name].classList.toggle('visible', name === screen);
    }
    // overlay screens sit on top; settings/howto opened from pause keep pause visible
    this.screens.pause.classList.toggle('visible', screen === 'pause' || ((screen === 'settings' || screen === 'howto') && this.settingsReturn === 'pause'));
    this.screens.results.classList.toggle('visible', screen === 'results');
    this.screens.settings.classList.toggle('visible', screen === 'settings');
    this.screens.howto.classList.toggle('visible', screen === 'howto');
  }

  private wireMenus(): void {
    id('btn-battle').onclick = () => { this.click(); this.show('deploy'); };
    id('btn-howto').onclick = () => { this.click(); this.settingsReturn = 'menu'; this.show('howto'); };
    id('btn-settings').onclick = () => { this.click(); this.settingsReturn = 'menu'; this.show('settings'); };
    id('btn-deploy-back').onclick = () => { this.click(); this.show('menu'); };
    id('btn-howto-back').onclick = () => { this.click(); this.show(this.settingsReturn === 'pause' ? 'pause' : 'menu'); };
    id('btn-settings-back').onclick = () => {
      this.click();
      this.settings.save();
      this.show(this.settingsReturn);
    };
    id('btn-deploy').onclick = () => {
      this.click();
      this.settings.data.lastMode = this.selectedMode.id;
      this.settings.data.lastTank = this.selectedTank;
      this.settings.save();
      this.cb.startBattle(this.selectedMode.id, this.selectedTank);
    };
    id('btn-resume').onclick = () => { this.click(); this.cb.resume(); };
    id('btn-pause-settings').onclick = () => { this.click(); this.settingsReturn = 'pause'; this.show('settings'); };
    id('btn-pause-howto').onclick = () => { this.click(); this.settingsReturn = 'pause'; this.show('howto'); };
    id('btn-leave').onclick = () => { this.click(); this.cb.leaveBattle(); };
    id('btn-rematch').onclick = () => { this.click(); this.cb.rematch(); };
    id('btn-results-menu').onclick = () => { this.click(); this.cb.leaveBattle(); };
  }

  click(): void {
    // audio wired by Game via window event hook; keep UI snappy
  }

  // ---------------- deploy ----------------

  private buildDeploy(): void {
    const modeWrap = id<HTMLDivElement>('mode-cards');
    modeWrap.innerHTML = '';
    for (const m of MATCH_MODES) {
      const card = document.createElement('div');
      card.className = 'mode-card' + (m.id === this.selectedMode.id ? ' selected' : '');
      card.innerHTML = `
        <div class="mc-tag">${m.teamSize} v ${m.teamSize}</div>
        <div class="mc-name">${m.id === '7v7' ? 'SKIRMISH <b>7v7</b>' : 'FRONTLINE <b>14v14</b>'}</div>
        <div class="mc-desc">${m.desc}</div>`;
      card.onclick = () => {
        this.selectedMode = m;
        modeWrap.querySelectorAll('.mode-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      };
      modeWrap.appendChild(card);
    }

    const tankWrap = id<HTMLDivElement>('tank-cards');
    tankWrap.innerHTML = '';
    for (const tid of TANK_IDS) {
      const spec = TANKS[tid];
      const card = document.createElement('div');
      card.className = 'tank-card' + (tid === this.selectedTank ? ' selected' : '');
      const hex = '#' + new Color(spec.colors.hull).getHexString();
      card.innerHTML = `
        <div class="tc-swatch" style="background: linear-gradient(135deg, ${hex}, ${hex} 60%, #2a2f26)"></div>
        <div class="tc-info">
          <div class="tc-name">${spec.name}</div>
          <div class="tc-class">${spec.cls} tank</div>
        </div>`;
      card.onclick = () => {
        this.selectedTank = tid;
        tankWrap.querySelectorAll('.tank-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.renderPreview();
      };
      tankWrap.appendChild(card);
    }
    this.renderPreview();
  }

  private renderPreview(): void {
    const spec = TANKS[this.selectedTank];
    const r = tankRatings(spec);
    const dps = (spec.gun.damage / spec.gun.reload).toFixed(0);
    const rows: [string, number, string][] = [
      ['Hit points', r.hp, `${spec.maxHp}`],
      ['Firepower', r.firepower, `${spec.gun.damage} dmg / ${dps} dps`],
      ['Armor', r.armor, `${spec.armor.front} front`],
      ['Mobility', r.speed, `${(spec.mobility.maxSpeed * 3.6).toFixed(0)} km/h`],
      ['Turret speed', r.turret, `${spec.mobility.turretRot.toFixed(1)} rad/s`],
    ];
    id<HTMLDivElement>('deploy-preview').innerHTML = `
      <div class="dp-name">${spec.name}</div>
      <div class="dp-desc">${spec.desc}</div>
      ${rows.map(([label, v, num]) => `
        <div class="stat-row">
          <span class="stat-label">${label}</span>
          <div class="stat-bar"><div class="stat-fill" style="width:${Math.round(Math.min(1, Math.max(0.08, v)) * 100)}%"></div></div>
          <span class="stat-num">${num}</span>
        </div>`).join('')}`;
  }

  // ---------------- settings ----------------

  private buildSettings(): void {
    const qWrap = id<HTMLDivElement>('quality-buttons');
    const levels: QualityLevel[] = ['low', 'medium', 'high'];
    const render = () => {
      qWrap.innerHTML = '';
      for (const l of levels) {
        const b = document.createElement('button');
        b.className = 'btn btn-small' + (this.settings.data.quality === l ? ' active' : '');
        b.textContent = QUALITY_PRESETS[l].label;
        b.onclick = () => {
          this.settings.data.quality = l;
          this.settings.save();
          render();
          this.cb.qualityChanged(l);
        };
        qWrap.appendChild(b);
      }
    };
    render();

    const sens = id<HTMLInputElement>('sensitivity');
    const sensVal = id<HTMLSpanElement>('sensitivity-val');
    sens.value = String(Math.round(this.settings.data.sensitivity * 100));
    sensVal.textContent = this.settings.data.sensitivity.toFixed(2);
    sens.oninput = () => {
      this.settings.data.sensitivity = Number(sens.value) / 100;
      sensVal.textContent = this.settings.data.sensitivity.toFixed(2);
    };

    const vol = id<HTMLInputElement>('volume');
    const volVal = id<HTMLSpanElement>('volume-val');
    vol.value = String(Math.round(this.settings.data.volume * 100));
    volVal.textContent = `${Math.round(this.settings.data.volume * 100)}%`;
    vol.oninput = () => {
      this.settings.data.volume = Number(vol.value) / 100;
      volVal.textContent = `${vol.value}%`;
    };

    const shakeBtn = id<HTMLButtonElement>('toggle-shake');
    const renderShake = () => { shakeBtn.textContent = this.settings.data.shake ? 'ON' : 'OFF'; shakeBtn.classList.toggle('active', this.settings.data.shake); };
    shakeBtn.onclick = () => { this.settings.data.shake = !this.settings.data.shake; this.settings.save(); renderShake(); };
    renderShake();

    const fpsBtn = id<HTMLButtonElement>('toggle-fps');
    const renderFps = () => { fpsBtn.textContent = this.settings.data.showFps ? 'ON' : 'OFF'; fpsBtn.classList.toggle('active', this.settings.data.showFps); this.fpsCounter.classList.toggle('on', this.settings.data.showFps); };
    fpsBtn.onclick = () => { this.settings.data.showFps = !this.settings.data.showFps; this.settings.save(); renderFps(); };
    renderFps();
  }

  // ---------------- HUD ----------------

  hudFrame(dt: number, data: {
    spec: TankSpec; hp: number; maxHp: number; reloadFrac: number; zoomed: boolean;
    speedKmh: number; buffs: { id: PowerupId; def: PowerupDef; time: number }[];
    scoreA: number; scoreB: number; timeLeft: number; alive: boolean; respawnTimer: number;
    killedBy: string;
  }): void {
    const hpFrac = data.hp / data.maxHp;
    this.hpFill.style.width = `${Math.max(0, hpFrac * 100)}%`;
    this.hpFill.className = hpFrac > 0.55 ? '' : hpFrac > 0.25 ? 'hurt' : 'critical';
    this.hpNum.textContent = `${Math.ceil(Math.max(0, data.hp))} / ${data.maxHp}`;
    this.tankName.innerHTML = `<b>${data.spec.name}</b><span>${data.spec.cls.toUpperCase()}</span>`;

    const rf = Math.min(1, Math.max(0, data.reloadFrac));
    const ready = rf >= 1;
    this.reloadRing.style.background = ready
      ? `conic-gradient(var(--reload-ready) 100%, transparent 0)`
      : `conic-gradient(var(--reload-warn) ${rf * 100}%, transparent 0)`;
    this.reloadRing.style.opacity = ready ? '0.35' : '0.9';
    this.reloadText.textContent = ready ? 'READY' : 'RELOADING';
    this.reloadText.className = ready ? '' : 'loading';
    this.crosshair.className = data.zoomed ? 'zoomed' : '';

    this.speedHud.textContent = `${Math.abs(Math.round(data.speedKmh))} km/h`;
    this.scoreA.textContent = String(data.scoreA);
    this.scoreB.textContent = String(data.scoreB);
    const t = Math.max(0, Math.ceil(data.timeLeft));
    this.matchTimer.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    this.matchTimer.classList.toggle('low', t <= 30);

    // buffs (rebuild at 5Hz or on change)
    this.buffAcc += dt;
    const key = data.buffs.map((b) => b.id).join(',');
    if (this.buffAcc > 0.2 || key !== this.lastBuffKey) {
      this.buffAcc = 0;
      this.lastBuffKey = key;
      this.buffBar.innerHTML = data.buffs.map((b) => `
        <div class="buff-chip">
          <span class="bc-icon" style="background:${b.def.cssColor}"></span>
          <span class="bc-name">${b.def.name}</span>
          <span class="bc-time">${Math.ceil(b.time)}s</span>
        </div>`).join('');
    }

    // vignettes
    this.vignetteLevel = Math.max(0, this.vignetteLevel - dt * 1.6);
    this.vignetteDamage.style.opacity = this.vignetteLevel.toFixed(2);
    this.vignetteLowHp.style.opacity = data.alive && hpFrac < 0.3 ? (0.5 + Math.sin(performance.now() / 300) * 0.2).toFixed(2) : '0';

    // respawn overlay
    if (!data.alive) {
      this.respawnOverlay.classList.add('visible');
      this.respawnKiller.textContent = data.killedBy ? `destroyed by ${data.killedBy}` : 'vehicle lost';
      this.respawnCount.textContent = String(Math.max(0, Math.ceil(data.respawnTimer)));
    } else {
      this.respawnOverlay.classList.remove('visible');
    }

    // controls hint fade
    this.hintTimer += dt;
    if (this.hintTimer > 12) this.controlsHint.classList.add('fade');
  }

  resetHud(): void {
    this.hintTimer = 0;
    this.controlsHint.classList.remove('fade');
    this.killfeedEl.innerHTML = '';
    this.buffBar.innerHTML = '';
    this.lastBuffKey = '';
    this.vignetteLevel = 0;
    this.respawnOverlay.classList.remove('visible');
  }

  killfeed(killerName: string, killerTeam: number, victimName: string, victimTeam: number): void {
    const item = document.createElement('div');
    item.className = 'kf-item';
    item.innerHTML = `<span class="${killerTeam === 0 ? 'kf-a' : 'kf-b'}">${killerName}</span><span class="kf-icon">✖</span><span class="${victimTeam === 0 ? 'kf-a' : 'kf-b'}">${victimName}</span>`;
    this.killfeedEl.prepend(item);
    while (this.killfeedEl.children.length > 6) this.killfeedEl.lastChild?.remove();
    setTimeout(() => item.remove(), 7000);
  }

  hitmarker(crit: boolean): void {
    this.hitmarkerEl.classList.toggle('crit', crit);
    this.hitmarkerEl.style.opacity = '1';
    clearTimeout(this.hitmarkerTimeout);
    this.hitmarkerTimeout = window.setTimeout(() => { this.hitmarkerEl.style.opacity = '0'; }, crit ? 200 : 120);
  }

  damageDirection(angleRad: number): void {
    this.dmgDir.style.transform = `rotate(${angleRad}rad)`;
    this.dmgDir.style.opacity = '1';
    clearTimeout(this.dirTimeout);
    this.dirTimeout = window.setTimeout(() => { this.dmgDir.style.opacity = '0'; }, 700);
  }

  addVignette(level: number): void {
    this.vignetteLevel = Math.min(1, this.vignetteLevel + level);
  }

  pickupToast(def: PowerupDef): void {
    const el = document.createElement('div');
    el.className = 'pb-item';
    el.style.borderColor = def.cssColor;
    el.style.color = def.cssColor;
    el.innerHTML = `<span style="width:12px;height:12px;background:${def.cssColor};display:inline-block;border-radius:2px"></span> ${def.name}`;
    this.pickupBanner.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 2700);
  }

  banner(text: string, sub: string): void {
    clearTimeout(this.bannerTimeout);
    this.battleBanner.innerHTML = `${text}<div class="bb-sub">${sub}</div>`;
    this.battleBanner.style.opacity = '1';
    this.bannerTimeout = window.setTimeout(() => { this.battleBanner.style.opacity = '0'; }, 3200);
  }

  fps(v: number): void {
    this.fpsCounter.textContent = `${v.toFixed(0)} FPS`;
  }

  // ---------------- results ----------------

  showResults(payload: {
    winner: -1 | 0 | 1; scores: [number, number]; rows: ScoreboardRow[]; elapsed?: number;
    player: { kills: number; deaths: number; damage: number; taken: number; shots: number; hits: number } | null;
  }): void {
    const banner = id<HTMLDivElement>('results-banner');
    banner.classList.remove('victory', 'defeat', 'draw');
    if (payload.winner === 0) { banner.textContent = 'VICTORY'; banner.classList.add('victory'); }
    else if (payload.winner === 1) { banner.textContent = 'DEFEAT'; banner.classList.add('defeat'); }
    else { banner.textContent = 'DRAW'; banner.classList.add('draw'); }

    id<HTMLSpanElement>('results-score-a').textContent = String(payload.scores[0]);
    id<HTMLSpanElement>('results-score-b').textContent = String(payload.scores[1]);

    const p = payload.player;
    const acc = p && p.shots > 0 ? Math.round((p.hits / p.shots) * 100) : 0;
    const minutes = Math.max(1, (payload.elapsed ?? MATCH_CONFIG.duration) / 60);
    id<HTMLDivElement>('player-stats').innerHTML = p ? `
      <div class="ps-cell"><div class="ps-val">${p.kills}</div><div class="ps-label">Kills</div></div>
      <div class="ps-cell"><div class="ps-val">${p.deaths}</div><div class="ps-label">Deaths</div></div>
      <div class="ps-cell"><div class="ps-val">${p.damage}</div><div class="ps-label">Damage dealt</div></div>
      <div class="ps-cell"><div class="ps-val">${p.taken}</div><div class="ps-label">Damage taken</div></div>
      <div class="ps-cell"><div class="ps-val">${p.shots}</div><div class="ps-label">Shots fired</div></div>
      <div class="ps-cell"><div class="ps-val">${acc}%</div><div class="ps-label">Accuracy</div></div>
      <div class="ps-cell"><div class="ps-val">${(p.damage / minutes).toFixed(0)}</div><div class="ps-label">DPM</div></div>
      <div class="ps-cell"><div class="ps-val">${payload.scores[0] > payload.scores[1] ? TEAMS[0].name : payload.scores[1] > payload.scores[0] ? TEAMS[1].name : '—'}</div><div class="ps-label">MVP team</div></div>
    ` : '';

    const sb = id<HTMLTableElement>('scoreboard');
    sb.innerHTML = `
      <tr><th>Team</th><th>Pilot</th><th>Vehicle</th><th>K</th><th>D</th><th>DMG</th><th>TAKEN</th></tr>
      ${payload.rows.map((r) => `
        <tr class="${r.isPlayer ? 'me' : ''}">
          <td class="tn-${r.team === 0 ? 'a' : 'b'}">${TEAMS[r.team].name}</td>
          <td>${r.name}</td><td>${r.tank}</td>
          <td>${r.kills}</td><td>${r.deaths}</td><td>${r.damage}</td><td>${r.taken}</td>
        </tr>`).join('')}`;
  }

  loading(p: number, tip: string): void {
    id<HTMLDivElement>('loading-fill').style.width = `${Math.round(p * 100)}%`;
    id<HTMLDivElement>('loading-tip').textContent = tip;
  }
}

// tiny local color helper to avoid importing three into UI
class Color {
  constructor(private hex: number) {}
  getHexString(): string {
    return this.hex.toString(16).padStart(6, '0');
  }
}
