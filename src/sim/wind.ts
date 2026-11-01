/**
 * Campo de viento compartido por el núcleo (caída de hojas por ráfagas) y por las
 * partículas visuales (trayectoria de las hojas que caen). Escala artística: la
 * velocidad media máxima es la de una brisa a escala de maceta, no un dato medido.
 * El rig de ramas (fase 5) usará esta misma API.
 */
import { eventUniform, smoothNoise1D } from './random.ts';
import type { Vec3 } from './vec3.ts';

export interface WindSettings {
  /** Intensidad del viento en [0, 1]. */
  intensity01: number;
  /** Dirección hacia la que sopla, en el plano horizontal (rad, 0 = +X). */
  directionRad: number;
}

export const CALM: WindSettings = { intensity01: 0, directionRad: 0 };

/** Velocidad media a intensidad 1 (m/s, artística). */
export const MAX_MEAN_WIND_MS = 1.6;

const WIND_ORGAN = 0xffff_fff0;
const CH_GUST = 40;
const CH_GUST_SLOW = 41;
const CH_GUST_FAST = 42;
const CH_TURB_X = 43;
const CH_TURB_Y = 44;
const CH_TURB_Z = 45;

/**
 * Intensidad de la ráfaga más fuerte de una semana biológica, en [0, 1]. Las ráfagas
 * fuertes son raras (distribución sesgada). Depende solo de semilla, tick y ajustes.
 */
export function weeklyGust01(settings: WindSettings, seed: number, tick: number): number {
  if (settings.intensity01 <= 0) return 0;
  const u = eventUniform(seed, WIND_ORGAN, tick >>> 0, CH_GUST);
  return Math.min(1, settings.intensity01 * (0.35 + 0.95 * u * u * u));
}

/** Factor de ráfaga continuo (≥ 0) en tiempo real de presentación. */
export function gustFactor(seed: number, tSeconds: number): number {
  const slow = smoothNoise1D(seed, WIND_ORGAN, tSeconds * 0.35, CH_GUST_SLOW);
  const fast = smoothNoise1D(seed, WIND_ORGAN, tSeconds * 1.9, CH_GUST_FAST);
  return Math.max(0, 1 + 0.7 * Math.max(0, slow) + 0.25 * fast);
}

/**
 * Velocidad del aire (m/s) en `p` y en el instante de presentación `tSeconds`:
 * componente media + ráfagas + turbulencia suave correlacionada en espacio y tiempo.
 */
export function windVelocityAt(
  settings: WindSettings,
  seed: number,
  tSeconds: number,
  p: Vec3,
): Vec3 {
  const mean = MAX_MEAN_WIND_MS * settings.intensity01;
  const g = mean * gustFactor(seed, tSeconds - 0.4 * (p[0] + p[2]));
  const dx = Math.cos(settings.directionRad);
  const dz = Math.sin(settings.directionRad);
  // Turbulencia: siempre presente un poco (aire de interior) y creciente con el viento.
  const turb = 0.05 + 0.35 * mean;
  const k = tSeconds * 0.8;
  const tx = turb * smoothNoise1D(seed, WIND_ORGAN, k + p[1] * 3 + p[2] * 2, CH_TURB_X);
  const ty = 0.6 * turb * smoothNoise1D(seed, WIND_ORGAN, k + p[0] * 3 + p[2] * 2, CH_TURB_Y);
  const tz = turb * smoothNoise1D(seed, WIND_ORGAN, k + p[0] * 2 + p[1] * 3, CH_TURB_Z);
  return [dx * g + tx, ty, dz * g + tz];
}
