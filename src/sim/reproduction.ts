/**
 * Flores y frutos (fases 4.7-4.8): calendario por flor, crecimiento del fruto y poses de
 * dibujo. Funciones puras compartidas por el motor y la instantánea de dibujo.
 */
import { yearOf } from './clock.ts';
import { hexToLinear, quatFromBasis } from './leaves.ts';
import { eventSigned, eventUniform } from './random.ts';
import type { FloweringProgram, FruitingProgram } from './species.ts';
import type { FlowerCohort, FruitState, Segment } from './types.ts';
import { UP, add, anyPerpendicular, cross, normalizeOr, scale, type Vec3 } from './vec3.ts';

const CH_FLOWER = 90;

/** Apertura de la flor i (años absolutos): desfase dentro de la cohorte. */
export function flowerOpenAt(
  program: FloweringProgram,
  seed: number,
  cohort: FlowerCohort,
  i: number,
): number {
  const spread = (program.bloom[1] - program.bloom[0]) * 0.35;
  return cohort.openAtYears + spread * eventUniform(seed, cohort.id, i, CH_FLOWER);
}

/** Caída de pétalos de la flor i. */
export function flowerShedAt(
  program: FloweringProgram,
  seed: number,
  cohort: FlowerCohort,
  i: number,
): number {
  const life =
    program.flowerLifeYears * (0.75 + 0.5 * eventUniform(seed, cohort.id, i, CH_FLOWER + 1));
  return flowerOpenAt(program, seed, cohort, i) + life;
}

/** Fecha de apertura de una cohorte: ventana de floración, antes con más luz. */
export function cohortOpenAt(
  program: FloweringProgram,
  seed: number,
  cohortId: number,
  bloomYear: number,
  exposure01: number,
): number {
  const span = program.bloom[1] - program.bloom[0];
  const u = eventUniform(seed, cohortId, 0, CH_FLOWER + 2);
  return bloomYear + program.bloom[0] + span * (0.55 * u + 0.1 * (1 - exposure01));
}

/** Dirección radial fija de un órgano del nudo i. */
function organRadial(seed: number, organId: number, i: number, seg: Segment): Vec3 {
  const a = Math.PI * (eventSigned(seed, organId, i, CH_FLOWER + 3) + i * 0.8);
  const u = seg.frameU;
  const v = cross(seg.direction, u);
  return add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
}

/** Escala relativa de la flor i: botón cerrado, apertura rápida, 0 tras perder pétalos. */
export function flowerOpenness(
  program: FloweringProgram,
  seed: number,
  cohort: FlowerCohort,
  i: number,
  t: number,
): number {
  if (((cohort.shedMask >>> i) & 1) === 1) return 0;
  const open = flowerOpenAt(program, seed, cohort, i);
  if (t < open) return 0.3;
  return 0.3 + 0.7 * Math.min(1, (t - open) / 0.008);
}

/** Pose de la flor i: corola hacia fuera y arriba. */
export function flowerPose(
  seed: number,
  seg: Segment,
  cohort: FlowerCohort,
  i: number,
  sizeM: number,
  out: Float32Array,
  o: number,
): void {
  const radial = organRadial(seed, cohort.id, i, seg);
  const z = normalizeOr(add(radial, scale(UP, 0.7)), UP);
  const y = anyPerpendicular(z);
  const x = cross(y, z);
  const p = add(seg.end, scale(radial, sizeM * 0.35));
  out[o] = p[0];
  out[o + 1] = p[1];
  out[o + 2] = p[2];
  quatFromBasis(x, y, z, out, o + 3);
}

/** Fecha de caída del fruto: temprana (fisiológica) o en la ventana de madurez. */
export function fruitDropPlan(
  program: FruitingProgram,
  seed: number,
  fruitId: number,
  setAtYears: number,
): { dropAtYears: number; earlyDrop: boolean } {
  const year = yearOf(setAtYears);
  const early = eventUniform(seed, fruitId, 0, CH_FLOWER + 4) < program.earlyDrop.probability;
  const u = eventUniform(seed, fruitId, 0, CH_FLOWER + 5);
  if (early) {
    const at = year + program.earlyDrop.phase + 0.04 * (u - 0.5);
    return { dropAtYears: Math.max(at, setAtYears + 0.02), earlyDrop: true };
  }
  return {
    dropAtYears: year + program.drop[0] + (program.drop[1] - program.drop[0]) * u,
    earlyDrop: false,
  };
}

/** Crecimiento del fruto [0, 1] hasta la madurez. */
export function fruitGrowth(program: FruitingProgram, fruit: FruitState, t: number): number {
  const ripenAt = yearOf(fruit.setAtYears) + program.ripenPhase;
  const x = Math.max(
    0,
    Math.min(1, (t - fruit.setAtYears) / Math.max(0.02, ripenAt - fruit.setAtYears)),
  );
  return x * x * (3 - 2 * x);
}

/** Masa fresca (kg): crece con el volumen del fruto. */
export function fruitMass(program: FruitingProgram, growth01: number): number {
  const size = 0.25 + 0.75 * growth01;
  return program.massKg * size * size * size;
}

export function fruitColor(
  program: FruitingProgram,
  fruit: FruitState,
  t: number,
): [number, number, number] {
  const ripenAt = yearOf(fruit.setAtYears) + program.ripenPhase;
  const k = Math.max(0, Math.min(1, (t - (ripenAt - 0.05)) / 0.08));
  const a = hexToLinear(program.colors.young);
  const b = hexToLinear(program.colors.ripe);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/** Pose del fruto: colgando del nudo (el eje y local apunta del fruto al pedúnculo). */
export function fruitPose(
  seed: number,
  seg: Segment,
  fruit: FruitState,
  out: Float32Array,
  o: number,
): void {
  const radial = organRadial(seed, fruit.flowerCohortId, fruit.index, seg);
  const y = normalizeOr(add(UP, scale(radial, 0.45)), UP);
  const x = anyPerpendicular(y);
  const z = cross(x, y);
  const p = add(seg.end, scale(radial, 0.003));
  out[o] = p[0];
  out[o + 1] = p[1];
  out[o + 2] = p[2];
  quatFromBasis(x, y, z, out, o + 3);
}
