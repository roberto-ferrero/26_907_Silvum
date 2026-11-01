/**
 * Reloj biológico fijo, separado del reloj de presentación (especificación §3).
 * Un tick = una semana simulada. La velocidad de reproducción solo decide cuántos
 * ticks se procesan por segundo real.
 */
export const TICKS_PER_YEAR = 52;
export const DT_YEARS = 1 / TICKS_PER_YEAR;

/** Ventanas estacionales como fracción del año (0 = 1 de enero). Hemisferio norte. */
export const SEASON = Object.freeze({
  budRelease: [0.2, 0.32] as const,
  elongation: [0.21, 0.45] as const,
  radialGrowth: [0.22, 0.75] as const,
  /** Evaluación anual de supervivencia, al final de la estación. */
  survivalAt: 0.8,
});

export function seasonPhase(timeYears: number): number {
  return timeYears - Math.floor(timeYears);
}

export function yearOf(timeYears: number): number {
  return Math.floor(timeYears + 1e-9);
}

export function inWindow(phase: number, window: readonly [number, number]): boolean {
  return phase >= window[0] && phase < window[1];
}

/** Progreso (0-1) dentro de una ventana; 0 antes, 1 después. */
export function windowProgress(phase: number, window: readonly [number, number]): number {
  return Math.max(0, Math.min(1, (phase - window[0]) / (window[1] - window[0])));
}

/** ¿Cruza el intervalo [t0, t1) el instante de fase `at`? */
export function crosses(t0: number, t1: number, at: number): boolean {
  const k = Math.floor(t0 - at) + 1;
  return at + k >= t0 - 1e-9 && at + k < t1 - 1e-9;
}

const SEASON_NAMES = ['invierno', 'primavera', 'verano', 'otoño'] as const;
export function seasonName(phase: number): (typeof SEASON_NAMES)[number] {
  const shifted = (phase + 1 / 12) % 1;
  return SEASON_NAMES[Math.floor(shifted * 4)] ?? 'invierno';
}
