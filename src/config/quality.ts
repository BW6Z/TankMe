/** Graphics quality presets. Applied to renderer/scene at runtime. */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityPreset {
  label: string;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  particleScale: number;
  fogFar: number;
  vegetationScale: number;
  antialias: boolean; // requires renderer recreation; applied on next launch otherwise
  nameSpritesRange: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'LOW',
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 512,
    particleScale: 0.45,
    fogFar: 300,
    vegetationScale: 0.55,
    antialias: false,
    nameSpritesRange: 90,
  },
  medium: {
    label: 'MEDIUM',
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    particleScale: 1.0,
    fogFar: 380,
    vegetationScale: 0.85,
    antialias: true,
    nameSpritesRange: 140,
  },
  high: {
    label: 'HIGH',
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    particleScale: 1.4,
    fogFar: 460,
    vegetationScale: 1.0,
    antialias: true,
    nameSpritesRange: 180,
  },
};
