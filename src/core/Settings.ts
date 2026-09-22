/** Persisted user settings. */
import type { QualityLevel } from '../config/quality';

export interface SettingsData {
  quality: QualityLevel;
  sensitivity: number; // 0.2 .. 2.0
  volume: number;      // 0..1
  shake: boolean;
  showFps: boolean;
  lastMode: '7v7' | '14v14';
  lastTank: string;
  /** UI language; undefined = auto-detect from the browser on first run */
  locale?: 'en-US' | 'zh-CN';
}

const KEY = 'tankme.settings.v1';

const defaults: SettingsData = {
  quality: 'medium',
  sensitivity: 1.0,
  volume: 0.8,
  shake: true,
  showFps: false,
  lastMode: '7v7',
  lastTank: 'vanguard',
};

export class Settings {
  data: SettingsData = { ...defaults };

  load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...defaults, ...JSON.parse(raw) };
    } catch { /* ignore */ }
  }

  save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch { /* ignore */ }
  }
}
