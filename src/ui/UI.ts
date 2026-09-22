/** All DOM UI: menus, deploy, settings, HUD, pause, results. */
import { MATCH_MODES, TEAMS } from '../config/match';
import { TANKS, TANK_IDS, tankRatings } from '../config/tanks';
import type { TankSpec } from '../config/tanks';
import { POWERUPS } from '../config/powerups';
import type { PowerupDef, PowerupId } from '../config/powerups';
import type { QualityLevel } from '../config/quality';
import { QUALITY_PRESETS } from '../config/quality';
import type { Settings } from '../core/Settings';
import type { ScoreboardRow } from '../match/MatchManager';
import { MATCH_CONFIG } from '../config/match';
import type { ModuleId } from '../config/combat';
import { MODULE_INFO } from '../config/combat';
import { t, applyDomTranslations, setLocale, getLocale, onLocaleChange } from '../core/i18n';
import type { Locale } from '../core/i18n';

export interface UICallbacks {
  startBattle(modeId: string, tankId: string): void;
  rematch(): void;
  leaveBattle(): void;
  resume(): void;
  previewTank(tankId: string): void;
  qualityChanged(q: QualityLevel): void;
}

type ScreenName = 'loading' | 'menu' | 'deploy' | 'settings' | 'howto' | 'battle' | 'pause' | 'results';

const BUFF_ICONS: Record<PowerupId, string> = {
  damage: 'i-shell', defense: 'i-shield', health: 'i-wrench', invisibility: 'i-cloak',
};

function id<T extends HTMLElement = HTMLElement>(name: string): T {
  const el = document.getElementById(name);
  if (!el) throw new Error(`Missing UI element #${name}`);
  return el as T;
}

export class UI {
  private screens: Record<ScreenName, HTMLElement>;
  private settingsReturn: 'menu' | 'pause' = 'menu';
  private selectedMode: (typeof MATCH_MODES)[number];
  private selectedTank: string;
  private hintTimer = 0;
  private buffAcc = 0;
  private lastBuffKey = '';
  private vignetteLevel = 0;
  private bannerTimeout: number | undefined;
  private scorePop = new Map<string, number>();

  private hpFill = id<HTMLDivElement>('hp-fill');
  private hpNum = id<HTMLDivElement>('hp-num');
  private hudTankName = id<HTMLDivElement>('hud-tank-name');
  private reloadRing = id<HTMLDivElement>('reload-ring');
  private reloadText = id<HTMLDivElement>('reload-text');
  private crosshair = id<HTMLDivElement>('crosshair');
  private gunMarker = id<HTMLDivElement>('gun-marker');
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
  private targetInfo = id<HTMLDivElement>('target-info');
  private tiName = id<HTMLSpanElement>('ti-name');
  private tiDist = id<HTMLSpanElement>('ti-dist');
  private tiHpFill = id<HTMLDivElement>('ti-hp-fill');
  private tiArmor = id<HTMLSpanElement>('ti-armor');
  private tiPen = id<HTMLSpanElement>('ti-pen');
  private cfLayer = id<HTMLDivElement>('combat-feedback');
  private killBanner = id<HTMLDivElement>('kill-banner');
  private killBannerTitle = id<HTMLDivElement>('kb-title');
  private killBannerSub = id<HTMLDivElement>('kb-sub');

  private hitmarkerTimeout: number | undefined;
  private dirTimeout: number | undefined;
  private killBannerTimeout: number | undefined;

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
    applyDomTranslations();
    this.syncLangButtons();
    id('team-a-label').textContent = TEAMS[0].name;
    id('team-b-label').textContent = TEAMS[1].name;
    id('results-team-a').textContent = TEAMS[0].name;
    id('results-team-b').textContent = TEAMS[1].name;
    // runtime language switch: re-apply static labels + rebuild dynamic blocks
    onLocaleChange(() => {
      applyDomTranslations();
      this.buildDeploy();
      this.buildSettings();
      this.syncLangButtons();
    });
    this.wireLangSwitch();
  }

  // ---------------- language ----------------

  private wireLangSwitch(): void {
    const apply = (l: Locale) => {
      setLocale(l, this.settings);
      this.syncLangButtons();
    };
    document.querySelectorAll<HTMLElement>('#lang-switch .lang-btn').forEach((b) => {
      b.onclick = () => { this.click(); apply(b.dataset.locale as Locale); };
    });
    document.querySelectorAll<HTMLElement>('#lang-buttons .btn-toggle').forEach((b) => {
      b.onclick = () => { this.click(); apply(b.dataset.locale as Locale); };
    });
  }

  private syncLangButtons(): void {
    const cur = getLocale();
    document.querySelectorAll<HTMLElement>('#lang-switch .lang-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.locale === cur);
    });
    document.querySelectorAll<HTMLElement>('#lang-buttons .btn-toggle').forEach((b) => {
      b.classList.toggle('active', b.dataset.locale === cur);
    });
    if (!document.getElementById('lang-buttons')?.children.length) this.buildLangButtons();
  }

  private buildLangButtons(): void {
    const wrap = id<HTMLDivElement>('lang-buttons');
    if (!wrap || wrap.children.length) return;
    for (const l of ['zh-CN', 'en-US'] as Locale[]) {
      const b = document.createElement('button');
      b.className = 'btn-toggle';
      b.dataset.locale = l;
      b.textContent = l === 'zh-CN' ? '简体中文' : 'English (US)';
      wrap.appendChild(b);
    }
    this.wireLangSwitch();
    this.syncLangButtons();
  }

  show(screen: ScreenName): void {
    const base: ScreenName[] = ['loading', 'menu', 'deploy', 'battle'];
    for (const name of base) {
      this.screens[name].classList.toggle('visible', name === screen);
    }
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

  click(): void { /* audio hooked by game */ }

  // ---------------- deploy ----------------

  private buildDeploy(): void {
    const modeWrap = id<HTMLDivElement>('mode-cards');
    modeWrap.innerHTML = '';
    for (const m of MATCH_MODES) {
      const card = document.createElement('div');
      card.className = 'mode-card' + (m.id === this.selectedMode.id ? ' selected' : '');
      const nameKey = m.id === '7v7' ? 'mode-7v7' : 'mode-14v14';
      const nameHtml = t(nameKey).replace(/(\d+v\d+)$/i, '<b>$1</b>');
      card.innerHTML = `
        <div class="mc-row">
          <div class="mc-name">${nameHtml}</div>
          <div class="mc-tag">${t('first-to', { n: m.scoreLimit })}</div>
        </div>
        <div class="mc-desc">${t(m.id === '7v7' ? 'mode-7v7-desc' : 'mode-14v14-desc')}</div>`;
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
      const r = tankRatings(spec);
      const card = document.createElement('div');
      card.className = 'tank-card' + (tid === this.selectedTank ? ' selected' : '');
      const hex = '#' + spec.colors.hull.toString(16).padStart(6, '0');
      const pips = (v: number) => Array.from({ length: 5 }, (_, i) => `<i class="${i < Math.round(v * 5) ? 'on' : ''}"></i>`).join('');
      card.innerHTML = `
        <div class="tc-sw" style="background: linear-gradient(135deg, ${hex}, #262b22)"></div>
        <div class="tc-info">
          <div class="tc-name">${spec.name}</div>
          <div class="tc-class">${t(`class-${spec.cls}`)}</div>
          <div class="tc-pips" title="${t('stat-firepower')}">${pips(r.firepower)}</div>
        </div>`;
      card.onclick = () => {
        this.selectedTank = tid;
        tankWrap.querySelectorAll('.tank-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        this.renderPreview();
        this.cb.previewTank(tid);
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
      [t('stat-hp'), r.hp, t('stat-hp-val', { n: spec.maxHp })],
      [t('stat-firepower'), r.firepower, t('stat-dmg', { n: spec.gun.damage })],
      [t('stat-dpm'), spec.gun.damage / spec.gun.reload / 55, `${dps} dps`],
      [t('stat-armor'), r.armor, t('stat-armor-val', { n: spec.armor.front })],
      [t('stat-mobility'), r.speed, `${(spec.mobility.maxSpeed * 3.6).toFixed(0)} ${t('unit-kmh')}`],
      [t('stat-turret'), r.turret, `${spec.mobility.turretRot.toFixed(1)} ${t('unit-rad')}`],
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
        b.className = 'btn-toggle' + (this.settings.data.quality === l ? ' active' : '');
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
    const renderShake = () => { shakeBtn.textContent = this.settings.data.shake ? t('on') : t('off'); shakeBtn.classList.toggle('active', this.settings.data.shake); };
    shakeBtn.onclick = () => { this.settings.data.shake = !this.settings.data.shake; this.settings.save(); renderShake(); };
    renderShake();

    const fpsBtn = id<HTMLButtonElement>('toggle-fps');
    const renderFps = () => { fpsBtn.textContent = this.settings.data.showFps ? t('on') : t('off'); fpsBtn.classList.toggle('active', this.settings.data.showFps); this.fpsCounter.classList.toggle('on', this.settings.data.showFps); };
    fpsBtn.onclick = () => { this.settings.data.showFps = !this.settings.data.showFps; this.settings.save(); renderFps(); };
    renderFps();
  }

  // ---------------- HUD ----------------

  hudFrame(dt: number, data: {
    spec: TankSpec; hp: number; maxHp: number; reloadFrac: number; reloadLeft: number; zoomed: boolean;
    speedKmh: number; spread: number;
    buffs: { id: PowerupId; def: PowerupDef; time: number }[];
    modules: ModuleId[];
    scoreA: number; scoreB: number; timeLeft: number; alive: boolean; respawnTimer: number;
    killedBy: string;
    gunMarker: { x: number; y: number; behind: boolean } | null;
    aimTarget: { name: string; hp: number; maxHp: number; dist: number; zone: string } | null;
    armorViz: { color: string; label: string; zone: string; eff: number } | null;
  }): void {
    const hpFrac = data.hp / data.maxHp;
    this.hpFill.style.width = `${Math.max(0, hpFrac * 100)}%`;
    this.hpFill.className = hpFrac > 0.55 ? '' : hpFrac > 0.25 ? 'hurt' : 'critical';
    this.hpNum.textContent = `${Math.ceil(Math.max(0, data.hp))} / ${data.maxHp}`;
    this.hudTankName.innerHTML = `<b>${data.spec.name}</b><span>${data.spec.cls.toUpperCase()}</span>`;

    const rf = Math.min(1, Math.max(0, data.reloadFrac));
    const ready = rf >= 1;
    this.reloadRing.style.background = ready
      ? `conic-gradient(var(--reload-ready) 100%, transparent 0)`
      : `conic-gradient(var(--reload-warn) ${rf * 100}%, transparent 0)`;
    this.reloadRing.style.opacity = ready ? '0.35' : '0.9';
    this.reloadText.textContent = ready ? t('hud-ready') : t('hud-reloading', { s: Math.max(0, data.reloadLeft).toFixed(1) });
    this.reloadText.className = ready ? '' : 'loading';
    this.crosshair.className = data.zoomed ? 'zoomed' : '';
    this.crosshair.style.setProperty('--spread', `${(6 + data.spread * 18).toFixed(1)}px`);

    // armor indicator color on the crosshair (green → red penetration chance)
    if (data.armorViz) {
      this.crosshair.style.setProperty('--armor-color', data.armorViz.color);
    } else {
      this.crosshair.style.removeProperty('--armor-color');
    }

    // gun alignment marker
    if (data.gunMarker && !data.gunMarker.behind) {
      this.gunMarker.style.display = 'block';
      this.gunMarker.style.left = `${(data.gunMarker.x * 100).toFixed(2)}%`;
      this.gunMarker.style.top = `${(data.gunMarker.y * 100).toFixed(2)}%`;
    } else {
      this.gunMarker.style.display = 'none';
    }

    // target info panel with armor readout
    if (data.aimTarget) {
      this.targetInfo.classList.add('visible', 'enemy');
      this.tiName.textContent = data.aimTarget.name;
      this.tiDist.textContent = `${Math.round(data.aimTarget.dist)} m`;
      this.tiHpFill.style.width = `${Math.max(0, (data.aimTarget.hp / data.aimTarget.maxHp) * 100)}%`;
      this.tiArmor.textContent = data.armorViz
        ? `${data.armorViz.zone} · ${Math.round(data.armorViz.eff)}mm`
        : data.aimTarget.zone ? data.aimTarget.zone : '—';
      this.tiPen.textContent = data.armorViz ? data.armorViz.label : '—';
      this.tiPen.style.color = data.armorViz ? data.armorViz.color : '';
    } else {
      this.targetInfo.classList.remove('visible');
    }

    this.speedHud.innerHTML = `${Math.abs(Math.round(data.speedKmh))} <span>km/h</span>`;
    this.setScore(this.scoreA, data.scoreA, 'a');
    this.setScore(this.scoreB, data.scoreB, 'b');
    const secs = Math.max(0, Math.ceil(data.timeLeft));
    this.matchTimer.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    this.matchTimer.classList.toggle('low', secs <= 30);

    // buffs + damaged modules (rebuild at 5Hz or on change)
    this.buffAcc += dt;
    const key = data.buffs.map((b) => b.id).join(',') + '|' + data.modules.join(',');
    if (this.buffAcc > 0.2 || key !== this.lastBuffKey) {
      this.buffAcc = 0;
      this.lastBuffKey = key;
      const buffChips = data.buffs.map((b) => `
        <div class="buff-chip">
          <svg style="color:${b.def.cssColor}"><use href="#${BUFF_ICONS[b.id]}"/></svg>
          <span class="bc-name">${t(`pu-${b.id}`)}</span>
          <span class="bc-time">${Math.ceil(b.time)}s</span>
          <div class="bc-bar" style="background:${b.def.cssColor};width:${Math.min(100, (b.time / b.def.duration) * 100)}%"></div>
        </div>`);
      const moduleChips = data.modules.map((m) => `
        <div class="buff-chip damaged">
          <span class="bc-name">${t(`mod-${m}`)}</span>
          <div class="bc-bar" style="background:${MODULE_INFO[m].cssColor}"></div>
        </div>`);
      this.buffBar.innerHTML = buffChips.join('') + moduleChips.join('');
    }

    // vignettes
    this.vignetteLevel = Math.max(0, this.vignetteLevel - dt * 1.6);
    this.vignetteDamage.style.opacity = this.vignetteLevel.toFixed(2);
    this.vignetteLowHp.style.opacity = data.alive && hpFrac < 0.3 ? (0.5 + Math.sin(performance.now() / 300) * 0.2).toFixed(2) : '0';

    // respawn overlay
    if (!data.alive) {
      this.respawnOverlay.classList.add('visible');
      this.respawnKiller.textContent = data.killedBy ? t('death-by', { name: data.killedBy }) : t('death-unknown');
      this.respawnCount.textContent = String(Math.max(0, Math.ceil(data.respawnTimer)));
    } else {
      this.respawnOverlay.classList.remove('visible');
    }

    // controls hint fade
    this.hintTimer += dt;
    if (this.hintTimer > 12) this.controlsHint.classList.add('fade');
  }

  private setScore(el: HTMLSpanElement, v: number, team: 'a' | 'b'): void {
    const key = team + v;
    if (!this.scorePop.has(key)) {
      const prev = team === 'a' ? this.lastA : this.lastB;
      if (v !== prev) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
      if (team === 'a') this.lastA = v; else this.lastB = v;
      this.scorePop.set(key, 1);
    }
    el.textContent = String(v);
  }
  private lastA = 0;
  private lastB = 0;

  resetHud(): void {
    this.hintTimer = 0;
    this.controlsHint.classList.remove('fade');
    this.killfeedEl.innerHTML = '';
    this.buffBar.innerHTML = '';
    this.lastBuffKey = '';
    this.vignetteLevel = 0;
    this.lastA = 0; this.lastB = 0;
    this.respawnOverlay.classList.remove('visible');
    this.targetInfo.classList.remove('visible');
    this.cfLayer.innerHTML = '';
    this.killBanner.classList.remove('visible');
    this.crosshair.style.removeProperty('--armor-color');
    this.scorePop.clear();
  }

  // ---------------- combat feedback ----------------

  /** transient text feedback in the center of the screen (pen/block/crit) */
  combatFeedback(text: string, cls: '' | 'good' | 'bad' | 'crit' | 'block' = ''): void {
    const el = document.createElement('div');
    el.className = `cf-item${cls ? ' ' + cls : ''}`;
    el.textContent = text;
    this.cfLayer.appendChild(el);
    while (this.cfLayer.children.length > 3) this.cfLayer.firstChild?.remove();
    window.setTimeout(() => { el.classList.add('out'); }, 1400);
    window.setTimeout(() => { el.remove(); }, 1900);
  }

  /** big center kill message with fade-in / hold / fade-out */
  killMessage(title: string, sub: string): void {
    this.killBannerTitle.textContent = title;
    this.killBannerSub.textContent = sub;
    this.killBanner.classList.remove('visible');
    void this.killBanner.offsetWidth; // restart the animation
    this.killBanner.classList.add('visible');
    clearTimeout(this.killBannerTimeout);
    this.killBannerTimeout = window.setTimeout(() => this.killBanner.classList.remove('visible'), 2600);
  }

  killfeed(killerName: string, killerTeam: number, victimName: string, victimTeam: number): void {
    const item = document.createElement('div');
    item.className = 'kf-item';
    item.innerHTML =
      `<span class="${killerTeam === 0 ? 'kf-a' : 'kf-b'}">${killerName}</span>` +
      `<svg><use href="#i-skull"/></svg>` +
      `<span class="${victimTeam === 0 ? 'kf-a' : 'kf-b'}">${victimName}</span>`;
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
    const iconId = BUFF_ICONS[def.id];
    el.innerHTML = `<svg style="color:${def.cssColor}"><use href="#${iconId}"/></svg> ${t(`pu-${def.id}`)}`;
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
    if (payload.winner === 0) { banner.textContent = t('res-victory'); banner.classList.add('victory'); }
    else if (payload.winner === 1) { banner.textContent = t('res-defeat'); banner.classList.add('defeat'); }
    else { banner.textContent = t('res-draw'); banner.classList.add('draw'); }

    id<HTMLSpanElement>('results-score-a').textContent = String(payload.scores[0]);
    id<HTMLSpanElement>('results-score-b').textContent = String(payload.scores[1]);

    const p = payload.player;
    const acc = p && p.shots > 0 ? Math.round((p.hits / p.shots) * 100) : 0;
    const minutes = Math.max(1, (payload.elapsed ?? MATCH_CONFIG.duration) / 60);
    id<HTMLDivElement>('player-stats').innerHTML = p ? `
      <div class="ps-cell"><div class="ps-val">${p.kills}</div><div class="ps-label">${t('res-kills')}</div></div>
      <div class="ps-cell"><div class="ps-val">${p.deaths}</div><div class="ps-label">${t('res-deaths')}</div></div>
      <div class="ps-cell"><div class="ps-val">${p.damage}</div><div class="ps-label">${t('res-dmg-dealt')}</div></div>
      <div class="ps-cell"><div class="ps-val">${p.taken}</div><div class="ps-label">${t('res-dmg-taken')}</div></div>
      <div class="ps-cell"><div class="ps-val">${p.shots}</div><div class="ps-label">${t('res-shots')}</div></div>
      <div class="ps-cell"><div class="ps-val">${acc}%</div><div class="ps-label">${t('res-accuracy')}</div></div>
      <div class="ps-cell"><div class="ps-val">${(p.damage / minutes).toFixed(0)}</div><div class="ps-label">${t('res-dpm')}</div></div>
      <div class="ps-cell"><div class="ps-val">${payload.scores[0] > payload.scores[1] ? TEAMS[0].name : payload.scores[1] > payload.scores[0] ? TEAMS[1].name : '—'}</div><div class="ps-label">${t('res-winner')}</div></div>
    ` : '';

    const sb = id<HTMLTableElement>('scoreboard');
    sb.innerHTML = `
      <tr><th>${t('sb-team')}</th><th>${t('sb-pilot')}</th><th>${t('sb-vehicle')}</th><th>${t('sb-k')}</th><th>${t('sb-d')}</th><th>${t('sb-dmg')}</th><th>${t('sb-taken')}</th></tr>
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
