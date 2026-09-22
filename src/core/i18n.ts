/**
 * i18n — lightweight localization for TankMe UI text.
 *
 * Two locales: 'en-US' (default) and 'zh-CN'. Text lives in the STRINGS
 * dictionary; components never hardcode user-visible copy — they call t().
 * Switching locale at runtime re-renders the UI: static HTML carries
 * data-i18n attributes (re-applied by UI.retranslate), dynamic blocks are
 * rebuilt, and per-frame strings re-evaluate t() naturally.
 */
import type { Settings } from './Settings';

export type Locale = 'en-US' | 'zh-CN';

type Entry = { en: string; zh: string };

export const STRINGS: Record<string, Entry> = {
  // ---- generic ----
  'on': { en: 'ON', zh: '开' },
  'off': { en: 'OFF', zh: '关' },
  'back': { en: '← BACK', zh: '← 返回' },

  // ---- loading ----
  'load-igniting': { en: 'Igniting renderer…', zh: '正在启动渲染器…' },
  'load-terrain': { en: 'Raising terrain…', zh: '正在生成地形…' },
  'load-navgrid': { en: 'Charting navigation grid…', zh: '正在构建导航网格…' },
  'load-ammo': { en: 'Loading ammunition…', zh: '正在装载弹药…' },
  'load-tanks': { en: 'Mustering tanks…', zh: '正在集结坦克…' },
  'load-vehicles': { en: 'Loading vehicle models…', zh: '正在载入车辆模型…' },
  'load-ready': { en: 'Ready', zh: '就绪' },
  'load-map': { en: 'IRONRIDGE CROSSING', zh: '铁脊隘口' },

  // ---- main menu ----
  'menu-battle': { en: 'BATTLE', zh: '开战' },
  'menu-howto': { en: 'HOW TO PLAY', zh: '操作说明' },
  'menu-settings': { en: 'SETTINGS', zh: '设置' },
  'menu-subline': { en: '3D TEAM TANK BATTLES', zh: '3D 团队坦克对战' },
  'menu-footer-1': { en: 'v0.2 · offline AI combat', zh: 'v0.2 · 离线 AI 对战' },
  'menu-footer-2': { en: 'Team Deathmatch · Ironridge Crossing', zh: '团队死斗 · 铁脊隘口' },

  // ---- deploy ----
  'deploy-title': { en: 'DEPLOY', zh: '出 击' },
  'deploy-go': { en: 'DEPLOY', zh: '出击' },
  'deploy-hint': { en: '◀ vehicle preview', zh: '◀ 车辆预览' },
  'label-mode': { en: 'BATTLE MODE', zh: '战斗模式' },
  'label-vehicle': { en: 'SELECT VEHICLE', zh: '选择车辆' },
  'label-performance': { en: 'PERFORMANCE', zh: '性能参数' },
  'briefing': {
    en: 'Team Deathmatch on <b>Ironridge Crossing</b>. Destroy enemy armor to score for your team. Higher score when the timer ends wins. Grab supply drops on the marked points for a combat edge.',
    zh: '在<b>铁脊隘口</b>进行团队死斗。击毁敌方坦克为队伍得分，计时结束时比分更高的队伍获胜。在标记点拾取空投物资可获得战斗优势。',
  },
  'first-to': { en: 'FIRST TO {n}', zh: '先达 {n} 分' },
  'mode-7v7': { en: 'SKIRMISH 7v7', zh: '遭遇战 7v7' },
  'mode-14v14': { en: 'FRONTLINE 14v14', zh: '前线会战 14v14' },
  'mode-7v7-desc': {
    en: 'Seven tanks per team. A focused, readable engagement across the whole valley.',
    zh: '每队七辆坦克。在整条山谷中展开目标明确、脉络清晰的小规模交战。',
  },
  'mode-14v14-desc': {
    en: 'Fourteen tanks per team. Total war — every lane contested, every stone counts.',
    zh: '每队十四辆坦克。全面战争——每条通路都有争夺，每块岩石都有价值。',
  },
  'class-light': { en: 'light tank', zh: '轻型坦克' },
  'class-medium': { en: 'medium tank', zh: '中型坦克' },
  'class-heavy': { en: 'heavy tank', zh: '重型坦克' },
  'class-td': { en: 'tank destroyer', zh: '坦克歼击车' },

  // ---- deploy preview stats ----
  'stat-hp': { en: 'Hit points', zh: '生命值' },
  'stat-firepower': { en: 'Firepower', zh: '火力' },
  'stat-dpm': { en: 'DPM', zh: '每分钟伤害' },
  'stat-armor': { en: 'Armor', zh: '装甲' },
  'stat-mobility': { en: 'Mobility', zh: '机动' },
  'stat-turret': { en: 'Turret', zh: '炮塔回转' },
  'stat-hp-val': { en: '{n} HP', zh: '{n} 生命' },
  'stat-dmg': { en: '{n} dmg', zh: '{n} 伤害' },
  'stat-armor-val': { en: '{n} front', zh: '正面 {n}' },
  'unit-kmh': { en: 'km/h', zh: '公里/时' },
  'unit-rad': { en: 'rad/s', zh: '弧度/秒' },

  // ---- how to play ----
  'howto-title': { en: 'HOW TO PLAY', zh: '操作说明' },
  'howto-drive': { en: 'Drive forward / reverse', zh: '前进 / 倒车' },
  'howto-steer': { en: 'Steer hull left / right', zh: '车体左转 / 右转' },
  'howto-aim': { en: 'Aim camera — turret follows', zh: '相机瞄准——炮塔跟随' },
  'howto-fire': { en: 'Fire main gun', zh: '发射主炮' },
  'howto-zoom': { en: 'Hold to zoom (gunner sight)', zh: '按住缩放（炮手瞄具）' },
  'howto-brake': { en: 'Emergency brake', zh: '紧急制动' },
  'howto-pause': { en: 'Pause menu', zh: '暂停菜单' },
  'howto-manual': { en: 'FIELD MANUAL', zh: '战场手册' },
  'tip-1': {
    en: '<b>Armor matters.</b> Frontal armor is thickest. Hit sides and especially the rear for far more damage.',
    zh: '<b>装甲很重要。</b>正面装甲最厚，打击侧面尤其车尾可造成数倍伤害。',
  },
  'tip-2': {
    en: '<b>Angle your hull.</b> Facing the enemy head-on makes their shots weaker.',
    zh: '<b>摆角度迎敌。</b>正对敌人会让对方的炮弹更难击穿。',
  },
  'tip-3': {
    en: '<b>Use cover.</b> Poke, shoot, hide. Reload behind buildings and rocks.',
    zh: '<b>利用掩体。</b>探头—射击—缩回。在建筑与岩石后完成装填。',
  },
  'tip-4': {
    en: '<b>Supply drops</b> fall on marked points: repair, shield, damage boost and cloaking.',
    zh: '<b>空投物资</b>会落在标记点：维修、护盾、伤害增强与隐身。',
  },
  'tip-5': {
    en: '<b>Teamwork wins.</b> Fight with your team — a lone tank is an easy kill.',
    zh: '<b>团队协作取胜。</b>跟随队友推进——落单的坦克就是活靶子。',
  },

  // ---- settings ----
  'settings-title': { en: 'SETTINGS', zh: '设置' },
  'set-graphics': { en: 'GRAPHICS', zh: '画面' },
  'set-quality': { en: 'QUALITY PRESET', zh: '画质预设' },
  'set-fps': { en: 'SHOW FPS', zh: '显示 FPS' },
  'set-controls': { en: 'CONTROLS', zh: '控制' },
  'set-sens': { en: 'MOUSE SENSITIVITY', zh: '鼠标灵敏度' },
  'set-shake': { en: 'CAMERA SHAKE', zh: '镜头震动' },
  'set-audio': { en: 'AUDIO', zh: '音频' },
  'set-volume': { en: 'MASTER VOLUME', zh: '主音量' },
  'set-language': { en: 'LANGUAGE', zh: '语言' },

  // ---- HUD ----
  'hud-mode': { en: 'TEAM DEATHMATCH', zh: '团队死斗' },
  'hud-ready': { en: 'READY', zh: '就绪' },
  'hud-reloading': { en: 'RELOADING · {s}s', zh: '装填中 · {s} 秒' },
  'hud-target': { en: 'TARGET', zh: '目标' },
  'hud-armor': { en: 'ARMOR', zh: '装甲' },
  'hud-penetration': { en: 'PENETRATION', zh: '击穿' },
  'hud-controls': {
    en: 'WASD drive · MOUSE aim · LMB fire · RMB zoom · ESC menu',
    zh: 'WASD 驾驶 · 鼠标瞄准 · 左键开火 · 右键缩放 · ESC 菜单',
  },
  'zone-front': { en: 'FRONT', zh: '正面' },
  'zone-side': { en: 'SIDE', zh: '侧面' },
  'zone-rear': { en: 'REAR', zh: '尾部' },
  'zone-turret': { en: 'TURRET', zh: '炮塔' },
  'zone-top': { en: 'ROOF', zh: '车顶' },
  'zone-tracks': { en: 'TRACKS', zh: '履带' },
  'verdict-green': { en: 'LIKELY', zh: '大概率击穿' },
  'verdict-yellow': { en: 'POSSIBLE', zh: '有可能击穿' },
  'verdict-orange': { en: 'UNLIKELY', zh: '较难击穿' },
  'verdict-red': { en: 'NO CHANCE', zh: '无法击穿' },

  // ---- powerups ----
  'pu-damage': { en: 'DAMAGE BOOST', zh: '伤害增强' },
  'pu-defense': { en: 'DEFENSE BOOST', zh: '防御增强' },
  'pu-health': { en: 'FIELD REPAIR', zh: '战地维修' },
  'pu-invisibility': { en: 'CLOAK FIELD', zh: '隐身力场' },

  // ---- modules ----
  'mod-track': { en: 'TRACK DAMAGED', zh: '履带受损' },
  'mod-engine': { en: 'ENGINE DAMAGED', zh: '发动机受损' },
  'mod-gun': { en: 'GUN DAMAGED', zh: '火炮受损' },

  // ---- combat feedback ----
  'cf-pen': { en: 'ARMOR PENETRATED −{n}', zh: '击穿装甲 −{n}' },
  'cf-ricochet': { en: 'RICOCHET', zh: '跳弹' },
  'cf-no-pen': { en: 'NO PENETRATION', zh: '未击穿' },
  'cf-ricochet-self': { en: 'RICOCHET OFF YOUR ARMOR', zh: '敌方炮弹被你的装甲弹开' },
  'cf-blocked': { en: 'ARMOR BLOCKED', zh: '装甲挡下炮弹' },
  'cf-crit': { en: 'CRITICAL HIT', zh: '致命一击' },
  'cf-module': { en: 'YOUR {m} DAMAGED', zh: '你的{m}受损' },

  // ---- kill messages ----
  'kill-enemy': { en: 'ENEMY DESTROYED', zh: '敌车被摧毁' },

  // ---- death / respawn ----
  'death-title': { en: 'VEHICLE DESTROYED', zh: '车辆被摧毁' },
  'death-by': { en: 'destroyed by {name}', zh: '被 {name} 击毁' },
  'death-unknown': { en: 'vehicle lost', zh: '车辆损失' },
  'respawn-in': { en: 'RESPAWN IN', zh: '重生倒计时' },

  // ---- battle banner ----
  'banner-sub': { en: '{mode} · FIRST TO {n} KILLS', zh: '{mode} · 先达 {n} 杀' },

  // ---- pause ----
  'pause-title': { en: 'PAUSED', zh: '已暂停' },
  'pause-resume': { en: 'RESUME', zh: '继续战斗' },
  'pause-settings': { en: 'SETTINGS', zh: '设置' },
  'pause-howto': { en: 'HOW TO PLAY', zh: '操作说明' },
  'pause-leave': { en: 'LEAVE BATTLE', zh: '离开战斗' },

  // ---- results ----
  'res-victory': { en: 'VICTORY', zh: '胜利' },
  'res-defeat': { en: 'DEFEAT', zh: '失败' },
  'res-draw': { en: 'DRAW', zh: '平局' },
  'res-final': { en: 'FINAL', zh: '最终比分' },
  'res-report': { en: 'BATTLE REPORT', zh: '战报' },
  'res-kills': { en: 'Kills', zh: '击杀' },
  'res-deaths': { en: 'Deaths', zh: '死亡' },
  'res-dmg-dealt': { en: 'Damage dealt', zh: '造成伤害' },
  'res-dmg-taken': { en: 'Damage taken', zh: '承受伤害' },
  'res-shots': { en: 'Shots fired', zh: '射击次数' },
  'res-accuracy': { en: 'Accuracy', zh: '命中率' },
  'res-dpm': { en: 'DPM', zh: '每分钟伤害' },
  'res-winner': { en: 'Winning team', zh: '获胜队伍' },
  'res-rematch': { en: 'REMATCH', zh: '再来一局' },
  'res-menu': { en: 'MAIN MENU', zh: '主菜单' },
  'sb-team': { en: 'Team', zh: '队伍' },
  'sb-pilot': { en: 'Pilot', zh: '车长' },
  'sb-vehicle': { en: 'Vehicle', zh: '车辆' },
  'sb-k': { en: 'K', zh: '击杀' },
  'sb-d': { en: 'D', zh: '阵亡' },
  'sb-dmg': { en: 'DMG', zh: '伤害' },
  'sb-taken': { en: 'TAKEN', zh: '承伤' },
};

let current: Locale = 'en-US';
const listeners: (() => void)[] = [];

export function initLocale(settings: Settings): void {
  const saved = settings.data.locale;
  if (saved === 'zh-CN' || saved === 'en-US') {
    current = saved;
  } else {
    current = navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
    settings.data.locale = current;
  }
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(l: Locale, settings?: Settings): void {
  if (l === current) return;
  current = l;
  if (settings) { settings.data.locale = l; settings.save(); }
  for (const fn of listeners) fn();
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** translate a key with {var} substitution */
export function t(key: string, vars?: Record<string, string | number>): string {
  const e = STRINGS[key];
  let s = e ? (current === 'zh-CN' ? e.zh : e.en) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  }
  return s;
}

/** apply data-i18n attributes to the DOM (static HTML labels) */
export function applyDomTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml!);
  });
}
