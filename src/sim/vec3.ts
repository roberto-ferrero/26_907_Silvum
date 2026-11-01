/** Operaciones mínimas sobre vectores 3D inmutables. Sistema derecho, +Y arriba. */
export type Vec3 = readonly [number, number, number];

export const UP: Vec3 = [0, 1, 0];
export const EPSILON = 1e-12;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
export const isFiniteVec = (v: Vec3): boolean => v.every(Number.isFinite);

/** Normaliza; lanza si la norma es nula o no finita. */
export function normalize(v: Vec3): Vec3 {
  const n = length(v);
  if (!(n > EPSILON) || !Number.isFinite(n)) {
    throw new RangeError('La dirección debe tener norma finita y no nula');
  }
  return scale(v, 1 / n);
}

/** Normaliza o devuelve `fallback` si la norma es casi nula. */
export function normalizeOr(v: Vec3, fallback: Vec3): Vec3 {
  const n = length(v);
  return n > 1e-9 && Number.isFinite(n) ? scale(v, 1 / n) : fallback;
}

export const projectOnPlane = (v: Vec3, normal: Vec3): Vec3 =>
  sub(v, scale(normal, dot(v, normal)));

/** Un vector unitario perpendicular a `t` (estable numéricamente). */
export function anyPerpendicular(t: Vec3): Vec3 {
  const helper: Vec3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalize(cross(helper, t));
}

/** Ángulo entre dos direcciones unitarias, en radianes. */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
}

/** Rota `v` alrededor del eje unitario `axis` (Rodrigues). */
export function rotateAround(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

/**
 * Gira `from` hacia `to` como máximo `maxAngle` radianes.
 * Si los vectores son opuestos, gira alrededor de una perpendicular cualquiera.
 */
export function rotateTowards(from: Vec3, to: Vec3, maxAngle: number): Vec3 {
  const angle = angleBetween(from, to);
  if (angle <= maxAngle || angle < 1e-9) return to;
  const axisRaw = cross(from, to);
  const axis = length(axisRaw) > 1e-9 ? normalize(axisRaw) : anyPerpendicular(from);
  return normalize(rotateAround(from, axis, maxAngle));
}

/**
 * Transporte paralelo de un marco: lleva `normal` de la tangente `t0` a `t1`
 * con la rotación mínima, evitando giros artificiales a lo largo del eje.
 */
export function transportNormal(normal: Vec3, t0: Vec3, t1: Vec3): Vec3 {
  const axisRaw = cross(t0, t1);
  const s = length(axisRaw);
  let n = normal;
  if (s > 1e-9) n = rotateAround(normal, scale(axisRaw, 1 / s), Math.atan2(s, dot(t0, t1)));
  const projected = projectOnPlane(n, t1);
  return length(projected) > 1e-9 ? normalize(projected) : anyPerpendicular(t1);
}
