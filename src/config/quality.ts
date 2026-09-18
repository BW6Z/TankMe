/** Graphics quality presets. Applied to renderer/scene at runtime. */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  label: string;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  particleScale: number;
  fogDensity: number;
  antialias: boolean;
  nameSpritesRange: number;
  /** post-processing chain (bloom + grade + AA) */
  postFx: boolean;
  bloomStrength: number;
  /** grass tuft count multiplier */
  vegetation: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'LOW',
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 512,
    particleScale: 0.45,
    fogDensity: 0.0032,
    antialias: false,
    nameSpritesRange: 90,
    postFx: false,
    bloomStrength: 0,
    vegetation: 0.4,
  },
  medium: {
    label: 'MEDIUM',
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    particleScale: 1.0,
    fogDensity: 0.0028,
    antialias: true,
    nameSpritesRange: 140,
    postFx: true,
    bloomStrength: 0.28,
    vegetation: 0.7,
  },
  high: {
    label: 'HIGH',
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    particleScale: 1.4,
    fogDensity: 0.0023,
    antialias: true,
    nameSpritesRange: 180,
    postFx: true,
    bloomStrength: 0.38,
    vegetation: 1.0,
  },
};
