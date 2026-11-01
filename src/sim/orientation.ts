import {
  add,
  cross,
  dot,
  normalize,
  normalizeOr,
  projectOnPlane,
  rotateTowards,
  scale,
  length,
  type Vec3,
} from './vec3.ts';

/**
 * Dirección de nacimiento de una lateral, relativa a su eje portador (especificación §4).
 * `insertionRad` respecto a la tangente; `azimuthRad` alrededor de ella desde `frameU`.
 */
export function branchBirthDirection(
  parentTangent: Vec3,
  frameU: Vec3,
  azimuthRad: number,
  insertionRad: number,
): Vec3 {
  if (!(insertionRad >= 0 && insertionRad <= Math.PI)) {
    throw new RangeError('insertionRad debe estar en [0, π]');
  }
  const t = normalize(parentTangent);
  const u = normalize(projectOnPlane(frameU, t));
  const v = cross(t, u);
  const radial = add(scale(u, Math.cos(azimuthRad)), scale(v, Math.sin(azimuthRad)));
  return normalize(add(scale(t, Math.cos(insertionRad)), scale(radial, Math.sin(insertionRad))));
}

/**
 * Dirección del cono de inclinación objetivo (respecto a la vertical del mundo) más
 * próxima a la actual. Cerca de la vertical usa el azimut persistente de la rama.
 */
export function inclinationTargetDirection(
  current: Vec3,
  up: Vec3,
  preferredAzimuth: Vec3,
  targetRad: number,
): Vec3 {
  if (!(targetRad >= 0 && targetRad <= Math.PI)) {
    throw new RangeError('targetRad debe estar en [0, π]');
  }
  const vertical = normalize(up);
  if (Math.abs(Math.sin(targetRad)) < 1e-9) return scale(vertical, Math.cos(targetRad));
  let horizontal = projectOnPlane(normalize(current), vertical);
  if (length(horizontal) < 1e-6) horizontal = projectOnPlane(preferredAzimuth, vertical);
  const h = normalizeOr(horizontal, [1, 0, 0]);
  return normalize(add(scale(vertical, Math.cos(targetRad)), scale(h, Math.sin(targetRad))));
}

export interface SteeringInput {
  tangent: Vec3;
  lightDirection: Vec3 | null;
  targetDirection: Vec3;
  /** Desviación correlacionada y acotada (no ruido por muestra). */
  noise: Vec3;
  weights: { heading: number; light: number; target: number };
  /** Longitud del nuevo entrenudo (m). */
  segmentLengthM: number;
  /** Giro máximo por metro (rad/m): reducir el segmento no multiplica el giro. */
  maxTurnRadPerM: number;
}

/**
 * Dirección de un nuevo entrenudo: suma ponderada normalizada de continuidad, luz y
 * objetivo (pesos de diseño, no fuerzas), limitada en giro por unidad de longitud.
 * Si la suma es casi nula se conserva la dirección anterior (especificación §7).
 */
export function steerDirection(input: SteeringInput): Vec3 {
  const t = normalize(input.tangent);
  let sum = scale(t, input.weights.heading);
  if (input.lightDirection) sum = add(sum, scale(input.lightDirection, input.weights.light));
  sum = add(sum, scale(input.targetDirection, input.weights.target));
  sum = add(sum, input.noise);
  const desired = normalizeOr(sum, t);
  return rotateTowards(t, desired, input.maxTurnRadPerM * input.segmentLengthM);
}

/** Inclinación respecto a la vertical, en [0, π]. */
export function inclinationFromUp(direction: Vec3, up: Vec3 = [0, 1, 0]): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(normalize(direction), normalize(up)))));
}
