/**
 * Envolvente de copa ARTÍSTICA (decisión del 1 nov 2026: priorizar árboles icónicos sobre
 * la fidelidad científica). Una especie puede declarar la silueta que una persona espera
 * ver (p. ej. la cúpula ancha del roble aislado) y el crecimiento se guía hacia ella:
 * - las yemas cerca de la superficie interior de la envolvente reciben más señal (la copa
 *   se rellena hasta su contorno), las del interior profundo algo menos y las de fuera
 *   casi nada;
 * - los brotes que se acercan al contorno se curvan hacia dentro.
 * La envolvente crece con la edad del árbol. No es biología: es dirección de arte.
 */
import type { Vec3 } from './vec3.ts';

export interface CrownEnvelopeProgram {
  /** Altura asintótica del árbol (m) y tiempo característico de crecimiento (años). */
  maxHeightM: number;
  growthYears: number;
  /** Anchura / altura de la copa, de joven a viejo (se interpola con la edad). */
  widthRatio: readonly [number, number];
  /** Años en que la anchura pasa de la proporción joven a la vieja. */
  widthMaturityYears: number;
  /** Base de la copa (fracción de la altura): por debajo, fuste limpio. */
  crownBase01: number;
  /** Altura de máxima anchura, como fracción de la longitud de copa desde su base. */
  widest01: number;
  /** Exponente del perfil inferior (> 2 = base de la copa más roma). */
  lowerExponent: number;
}

export interface EnvelopeShape {
  heightM: number;
  radiusM: number;
  baseY: number;
  widestY: number;
  lowerExponent: number;
}

export function envelopeAt(program: CrownEnvelopeProgram, ageYears: number): EnvelopeShape {
  const age = Math.max(0, ageYears);
  const heightM = program.maxHeightM * (1 - Math.exp(-age / program.growthYears));
  const k = Math.min(1, age / program.widthMaturityYears);
  const ratio = program.widthRatio[0] + (program.widthRatio[1] - program.widthRatio[0]) * k;
  const baseY = program.crownBase01 * heightM;
  return {
    heightM,
    radiusM: (ratio * heightM) / 2,
    baseY,
    widestY: baseY + program.widest01 * (heightM - baseY),
    lowerExponent: program.lowerExponent,
  };
}

/** Distancia normalizada al contorno: < 1 dentro, 1 en la superficie, > 1 fuera. */
export function envelopeDistance(e: EnvelopeShape, p: Vec3): number {
  if (e.heightM <= 0) return 0;
  const u = Math.hypot(p[0], p[2]) / Math.max(1e-6, e.radiusM);
  const above = p[1] >= e.widestY;
  const span = above ? e.heightM - e.widestY : e.widestY - e.baseY;
  const v = Math.abs(p[1] - e.widestY) / Math.max(1e-6, span);
  const q = above ? 2 : e.lowerExponent;
  return Math.sqrt(u * u + v ** q);
}

/** Dirección hacia fuera del contorno en `p` (aproximada, unitaria). */
export function envelopeNormal(e: EnvelopeShape, p: Vec3): Vec3 {
  const above = p[1] >= e.widestY;
  const span = Math.max(1e-6, above ? e.heightM - e.widestY : e.widestY - e.baseY);
  const r2 = e.radiusM * e.radiusM;
  const n: [number, number, number] = [p[0] / r2, (p[1] - e.widestY) / (span * span), p[2] / r2];
  const len = Math.hypot(n[0], n[1], n[2]);
  return len > 1e-9 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 1, 0];
}

/**
 * Factor de señal de una yema según su distancia normalizada: la corteza exterior de la
 * copa (0,75-1) es la más favorecida, el interior profundo menos y fuera se apaga.
 */
export function envelopeSignalFactor(d: number): number {
  if (d > 1) return 1.3 * Math.exp(-(d - 1) * 9);
  if (d >= 0.75) return 1.3;
  if (d >= 0.45) return 0.25 + (1.05 * (d - 0.45)) / 0.3;
  return 0.25;
}
