/**
 * Hojas (fase 4.6): rasgos por hoja derivados por identidad, progreso de senescencia,
 * color no uniforme y pose de dibujo. Funciones puras: las usan el motor (caídas) y la
 * instantánea de dibujo, así que una hoja que cae parte exactamente de donde se veía.
 */
import { yearOf } from './clock.ts';
import { eventSigned, eventUniform } from './random.ts';
import type { Hex, LeafForm, Species } from './species.ts';
import type { LeafCohort, Segment } from './types.ts';
import { UP, add, cross, dot, normalizeOr, scale, sub, type Vec3 } from './vec3.ts';

/** Rasgos por hoja (índices en el bloque de cada hoja). */
export const LEAF_TRAIT = Object.freeze({
  senescenceOffset: 0,
  speed: 1,
  lag: 2,
  size: 3,
  azimuthJitter: 4,
  tilt: 5,
  tone: 6,
  marcescent: 7,
  along: 8,
});
const TRAITS = 9;
const CH_BASE = 60;

/**
 * Caché de rasgos por (semilla, cohorte). Es segura entre simulaciones porque los
 * rasgos dependen solo de la semilla y de ids estables.
 */
const traitCache = new Map<number, Map<number, Float32Array>>();
let cachedEntries = 0;

export function leafTraits(seed: number, cohortId: number, count: number): Float32Array {
  let bySeed = traitCache.get(seed);
  if (!bySeed) {
    bySeed = new Map();
    traitCache.set(seed, bySeed);
  }
  const hit = bySeed.get(cohortId);
  if (hit && hit.length >= count * TRAITS) return hit;
  if (cachedEntries > 400_000) {
    traitCache.clear();
    cachedEntries = 0;
    return leafTraits(seed, cohortId, count);
  }
  const t = new Float32Array(count * TRAITS);
  for (let i = 0; i < count; i++) {
    const o = i * TRAITS;
    const u = (k: number): number => eventUniform(seed, cohortId, i, CH_BASE + k);
    t[o + LEAF_TRAIT.senescenceOffset] = u(0);
    t[o + LEAF_TRAIT.speed] = 0.7 + 0.7 * u(1);
    t[o + LEAF_TRAIT.lag] = 0.08 + 0.35 * u(2);
    t[o + LEAF_TRAIT.size] = 0.82 + 0.36 * u(3);
    t[o + LEAF_TRAIT.azimuthJitter] = eventSigned(seed, cohortId, i, CH_BASE + 4);
    t[o + LEAF_TRAIT.tilt] = eventSigned(seed, cohortId, i, CH_BASE + 5);
    t[o + LEAF_TRAIT.tone] = u(6);
    t[o + LEAF_TRAIT.marcescent] = u(7);
    t[o + LEAF_TRAIT.along] = eventSigned(seed, cohortId, i, CH_BASE + 8);
  }
  bySeed.set(cohortId, t);
  cachedEntries += count;
  return t;
}

export const trait = (t: Float32Array, i: number, k: number): number => t[i * TRAITS + k]!;

/**
 * Progreso de senescencia de la hoja i (sin acotar por arriba): 0 verde, 1 color final.
 * Cada hoja tiene su desfase dentro de la cohorte y su velocidad (cambio no uniforme).
 */
export function senescenceProgress(
  species: Species,
  cohort: LeafCohort,
  traits: Float32Array,
  i: number,
  t: number,
): number {
  if (cohort.withered)
    return Math.max(0, (t - cohort.senescenceAtYears) / cohort.senescenceSpanYears);
  const off = trait(traits, i, LEAF_TRAIT.senescenceOffset) * species.leaves.senescenceSpreadYears;
  const speed = trait(traits, i, LEAF_TRAIT.speed);
  return Math.max(0, ((t - cohort.senescenceAtYears - off) * speed) / cohort.senescenceSpanYears);
}

/** ¿Es una hoja marcescente (queda seca en el árbol hasta la brotación)? */
export function isMarcescent(species: Species, traits: Float32Array, i: number): boolean {
  return (
    species.leaves.habit === 'deciduous' &&
    trait(traits, i, LEAF_TRAIT.marcescent) < species.leaves.marcescence
  );
}

/** Instante de caída de una hoja marcescente: la brotación del año siguiente. */
export function marcescentDropAt(
  species: Species,
  cohort: LeafCohort,
  traits: Float32Array,
  i: number,
): number {
  return (
    yearOf(cohort.senescenceAtYears) +
    1 +
    species.phenology.budRelease[0] +
    0.08 * trait(traits, i, LEAF_TRAIT.senescenceOffset)
  );
}

/**
 * Inicio de senescencia de una cohorte. Caducas: ventana de la especie desplazada por luz
 * (las hojas de sol cambian antes), salud, altura y una variación por cohorte.
 * Perennes: el último año de vida de la hoja, acortado si la salud es baja.
 */
export function cohortSenescenceAt(
  species: Species,
  seed: number,
  cohortId: number,
  bornAtYears: number,
  exposure01: number,
  health01: number,
  heightM: number,
): number {
  const l = species.leaves;
  const sen = species.phenology.senescence;
  const jitter = eventSigned(seed, cohortId, 0, CH_BASE + 20);
  if (l.habit === 'deciduous') {
    const shift =
      -0.03 * (exposure01 - 0.5) * 2 - 0.04 * (1 - health01) - 0.01 * heightM + 0.015 * jitter;
    return yearOf(bornAtYears) + sen[0] + shift;
  }
  const life = l.lifespanYears * (1 + l.lifespanJitter * jitter) * (0.6 + 0.4 * health01);
  return yearOf(bornAtYears + Math.max(1, life)) + sen[0];
}

/** Salud de una cohorte a partir de la luz (sombra prolongada = hoja débil). */
export function healthFromExposure(exposure01: number): number {
  return Math.max(0.15, Math.min(1, 0.3 + exposure01 * 0.9));
}

// ── Color ───────────────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

const hexCache = new Map<string, RGB>();
/** Hex sRGB → RGB lineal (espacio de trabajo del renderer). */
export function hexToLinear(hex: Hex | string): RGB {
  const hit = hexCache.get(hex);
  if (hit) return hit;
  const n = parseInt(hex.slice(1), 16);
  const rgb: RGB = [
    srgbToLinear(((n >> 16) & 255) / 255),
    srgbToLinear(((n >> 8) & 255) / 255),
    srgbToLinear((n & 255) / 255),
  ];
  hexCache.set(hex, rgb);
  return rgb;
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const smooth = (x: number): number => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const PALE: RGB = hexToLinear('#a3a64e');

/** Tono de senescencia de la hoja: su mezcla de la paleta, sesgada a cálidos con más luz. */
function senescentTone(species: Species, cohort: LeafCohort, traits: Float32Array, i: number): RGB {
  const tones = species.leaves.colors.senescent;
  const bias = species.leaves.sunRedness * (cohort.exposure01 - 0.4);
  const x =
    Math.max(0, Math.min(1, trait(traits, i, LEAF_TRAIT.tone) * 0.85 + bias)) * (tones.length - 1);
  const k = Math.min(tones.length - 2, Math.floor(x));
  if (tones.length === 1) return hexToLinear(tones[0]!);
  return mixRGB(hexToLinear(tones[k]!), hexToLinear(tones[k + 1]!), x - k);
}

/** Color lineal de una hoja unida en el instante t. */
export function leafColor(
  species: Species,
  cohort: LeafCohort,
  traits: Float32Array,
  i: number,
  t: number,
): RGB {
  const c = species.leaves.colors;
  const expansion = smooth((t - cohort.bornAtYears) / species.phenology.leafExpansionYears);
  let rgb = mixRGB(hexToLinear(c.young), hexToLinear(c.mature), expansion);
  rgb = mixRGB(rgb, PALE, 0.35 * (1 - cohort.health01));
  const p = senescenceProgress(species, cohort, traits, i, t);
  if (p <= 0) return rgb;
  const tone = senescentTone(species, cohort, traits, i);
  if (p < 1) return mixRGB(rgb, tone, smooth(p / 0.85));
  const lag = trait(traits, i, LEAF_TRAIT.lag);
  return mixRGB(tone, hexToLinear(c.dead), Math.min(1, (p - 1) / lag));
}

/** Escala de dibujo (longitud del limbo en m) de una hoja unida. */
export function leafScale(
  species: Species,
  cohort: LeafCohort,
  traits: Float32Array,
  i: number,
  t: number,
): number {
  const e = smooth((t - cohort.bornAtYears) / species.phenology.leafExpansionYears);
  return species.leaves.form.lengthM * trait(traits, i, LEAF_TRAIT.size) * (0.2 + 0.8 * e);
}

// ── Forma individual ───────────────────────────────────────────────────────────────

/** Variación de la forma de hoja por individuo (4.6.1): mismo árbol, misma hoja tipo. */
export function individualLeafForm(species: Species, seed: number): LeafForm {
  const f = species.leaves.form;
  const v = (k: number): number => eventSigned(seed, 0, 0, CH_BASE + 30 + k);
  return {
    ...f,
    lengthM: f.lengthM * (1 + 0.1 * v(0)),
    widthRatio: f.widthRatio * (1 + 0.08 * v(1)),
    lobeDepth: Math.max(0, f.lobeDepth * (1 + 0.18 * v(2))),
    toothDepth: Math.max(0, f.toothDepth * (1 + 0.2 * v(3))),
    curl: f.curl * (1 + 0.25 * v(4)),
  };
}

// ── Pose ───────────────────────────────────────────────────────────────────────────

/** Cuaternión (x, y, z, w) de la base ortonormal con columnas (x, y, z). */
export function quatFromBasis(x: Vec3, y: Vec3, z: Vec3, out: Float32Array, o: number): void {
  const [m00, m10, m20] = x;
  const [m01, m11, m21] = y;
  const [m02, m12, m22] = z;
  const tr = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  out[o] = qx;
  out[o + 1] = qy;
  out[o + 2] = qz;
  out[o + 3] = qw;
}

/**
 * Base de dibujo de un órgano laminar: y = dirección del limbo, z = normal (hacia el
 * cielo, fototropismo foliar), x = y × z. `tilt` gira la normal alrededor del limbo.
 */
export function bladeBasis(length: Vec3, tilt: number): [Vec3, Vec3, Vec3] {
  const y = normalizeOr(length, UP);
  let z = normalizeOr(sub(UP, scale(y, dot(UP, y))), [1, 0, 0]);
  if (Math.abs(dot(y, UP)) > 0.995) z = normalizeOr(cross(y, [1, 0, 0]), [0, 0, 1]);
  let x = cross(y, z);
  if (tilt !== 0) {
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    z = normalizeOr(add(scale(z, c), scale(x, s)), z);
    x = cross(y, z);
  }
  return [x, y, z];
}

/**
 * Posición y orientación de la hoja i: `out[o..o+2]` posición, `out[o+3..o+6]` cuaternión.
 * Hojas en el nudo con el azimut de su yema axilar; acículas a lo largo del entrenudo,
 * en espiral o pectinadas (dos filas casi horizontales) en ramas laterales.
 */
export function leafPose(
  species: Species,
  seg: Segment,
  cohort: LeafCohort,
  traits: Float32Array,
  i: number,
  out: Float32Array,
  o: number,
): void {
  const l = species.leaves;
  const t = seg.direction;
  const u = seg.frameU;
  const v = cross(t, u);
  const jitter = trait(traits, i, LEAF_TRAIT.azimuthJitter);
  const divergence = (species.phyllotaxis.divergenceDeg * Math.PI) / 180;
  let radial: Vec3;
  let pos: Vec3 = seg.end;
  const horizontalAxis = Math.abs(dot(t, UP)) < 0.8;
  if (l.arrangement === 'pectinate' && horizontalAxis) {
    const side = i % 2 === 0 ? 1 : -1;
    const h = normalizeOr(cross(UP, t), u);
    radial = normalizeOr(add(scale(h, side), scale(UP, 0.3 + 0.15 * jitter)), h);
  } else {
    // Varias hojas en el nudo (roseta de un brote corto): espiral con la divergencia.
    const az = cohort.baseAzimuthRad + i * divergence;
    const a = az + 0.25 * jitter;
    radial = add(scale(u, Math.cos(a)), scale(v, Math.sin(a)));
  }
  if (l.arrangement !== 'node') {
    const f = (i + 0.5) / cohort.count + (0.3 * trait(traits, i, LEAF_TRAIT.along)) / cohort.count;
    pos = add(seg.start, scale(sub(seg.end, seg.start), Math.max(0, Math.min(1, f))));
  }
  const ins = (l.insertionDeg * Math.PI) / 180;
  const droop = l.form.shape === 'needle' ? 0.08 : 0.3;
  const blade = add(add(scale(t, Math.cos(ins)), scale(radial, Math.sin(ins))), scale(UP, -droop));
  const [x, y, z] = bladeBasis(blade, 0.45 * trait(traits, i, LEAF_TRAIT.tilt));
  out[o] = pos[0];
  out[o + 1] = pos[1];
  out[o + 2] = pos[2];
  quatFromBasis(x, y, z, out, o + 3);
}
