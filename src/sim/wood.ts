/**
 * Engrosamiento (especificación §8). El radio exterior es un estado acumulado y monotónico:
 * la regla tipo pipe es un objetivo geométrico, no una ley universal.
 */

/** r = (Σ r_i^p)^(1/p). Con p = 2 se conserva el área en una bifurcación ideal. */
export function pipeTargetRadius(childRadii: readonly number[], exponent: number): number {
  if (!(exponent >= 1 && exponent <= 4)) throw new RangeError('exponent debe estar en [1, 4]');
  let sum = 0;
  for (const r of childRadii) {
    if (!(r >= 0) || !Number.isFinite(r)) throw new RangeError('radios no válidos');
    sum += r ** exponent;
  }
  return sum ** (1 / exponent);
}

/** r' = r + min(max(0, objetivo - r), vMax·dt·actividad). Nunca decrece. */
export function growRadius(
  currentRadiusM: number,
  targetRadiusM: number,
  maxRadialGrowthMPerYear: number,
  dtYears: number,
  activeGrowth01: number,
): number {
  if (!(currentRadiusM >= 0) || !Number.isFinite(currentRadiusM)) {
    throw new RangeError('currentRadiusM no válido');
  }
  const activity = Math.max(0, Math.min(1, activeGrowth01));
  const cap = Math.max(0, maxRadialGrowthMPerYear) * Math.max(0, dtYears) * activity;
  const deficit = Math.max(0, targetRadiusM - currentRadiusM);
  return currentRadiusM + Math.min(deficit, cap);
}

/** Segundo momento de área de una sección circular: I = π r⁴ / 4. */
export function circularSecondMoment(radiusM: number): number {
  return (Math.PI * radiusM ** 4) / 4;
}
