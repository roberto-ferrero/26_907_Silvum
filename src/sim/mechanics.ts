/**
 * Mecánica de ramas (fase 5.1-5.3): masa acumulada por subárbol (madera, hojas, frutos),
 * centro de masas, área foliar, rigidez a flexión dependiente del radio e inercia.
 *
 * Valores ARTÍSTICOS declarados (escala de maceta): se eligen para que una rama madre se
 * combe unos grados con su peso y se mezca con el viento a 1-2 Hz, no medidos.
 * Lo usan el núcleo (memoria lenta de forma, 5.6) y el rig de presentación (5.4-5.5).
 */
import type { Species } from './species.ts';
import type { TreeState } from './types.ts';
import { add, cross, length, scale, sub, type Vec3 } from './vec3.ts';

export const MECH = Object.freeze({
  /** Densidad de la madera (kg/m³). */
  woodDensityKgM3: 750,
  /** Masa de una hoja (kg). */
  leafMassKg: 0.0004,
  /** Rigidez a flexión: k = S · r⁴ / L (N·m/rad), con S artístico. */
  stiffnessScale: 8e7,
  /** Frecuencia propia máxima (Hz): las ramillas no vibran más rápido que esto. */
  maxNaturalHz: 2.2,
  /** Amortiguamiento relativo. */
  dampingRatio: 0.18,
  /** Combadura estática máxima por eje (rad), aproximación de ángulo pequeño. */
  maxStaticBendRad: 0.35,
  gravity: 9.81,
});

export interface AxisMechanics {
  axisId: number;
  parentAxisId: number | null;
  /** Punto de inserción (inicio del primer entrenudo). */
  pivot: Vec3;
  /** Masa del subárbol (kg) y su centro de masas. */
  massKg: number;
  com: Vec3;
  /** Área foliar del subárbol (m²), para el arrastre del viento. */
  leafAreaM2: number;
  /** Radio en la base y longitud propia del eje (m). */
  baseRadiusM: number;
  lengthM: number;
  /** Rigidez (N·m/rad), inercia (kg·m²) y amortiguamiento (N·m·s/rad). */
  stiffness: number;
  inertia: number;
  damping: number;
}

/** Área de una hoja de la especie (m²): limbo aproximado como elipse. */
export function leafAreaM2(species: Species): number {
  const f = species.leaves.form;
  return (Math.PI / 4) * f.lengthM * f.lengthM * f.widthRatio;
}

const popcount = (m: number): number => {
  let x = m >>> 0;
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
};

/**
 * Mecánica de todos los ejes vivos o muertos retenidos (no desprendidos).
 * `foliage`: 'attached' cuenta las hojas unidas ahora (rig); 'initial' la carga foliar de
 * cada cohorte al formarse (memoria de forma: no depende de las hojas que arranque el
 * viento, que es un evento del entorno).
 */
export function axisMechanics(
  s: TreeState,
  species: Species,
  foliage: 'attached' | 'initial' = 'attached',
): Map<number, AxisMechanics> {
  const out = new Map<number, AxisMechanics>();
  const leafArea = leafAreaM2(species);
  // Masa propia de cada eje y su momento (Σ m·x) para el centro de masas.
  const moment = new Map<number, Vec3>();
  for (const axis of Object.values(s.axes)) {
    if (axis.woodState === 'detached') continue;
    const segs = axis.segmentIds.map((id) => s.segments[id]).filter((g) => g !== undefined);
    if (segs.length === 0) continue;
    let mass = 0;
    let m: Vec3 = [0, 0, 0];
    let len = 0;
    for (const g of segs) {
      const w = Math.PI * g.radiusM * g.radiusM * g.lengthM * MECH.woodDensityKgM3;
      mass += w;
      m = add(m, scale(add(g.start, g.end), w / 2));
      len += g.lengthM;
    }
    const first = segs[0]!;
    const radius = first.radiusM;
    const stiffness = (MECH.stiffnessScale * radius ** 4) / Math.max(len, 0.02);
    out.set(axis.id, {
      axisId: axis.id,
      parentAxisId: axis.parentAxisId,
      pivot: first.start,
      massKg: mass,
      com: [0, 0, 0],
      leafAreaM2: 0,
      baseRadiusM: radius,
      lengthM: len,
      stiffness,
      inertia: 0,
      damping: 0,
    });
    moment.set(axis.id, m);
  }
  const addPoint = (axisId: number, p: Vec3, kg: number, area: number): void => {
    const a = out.get(axisId);
    if (!a) return;
    a.massKg += kg;
    a.leafAreaM2 += area;
    moment.set(axisId, add(moment.get(axisId)!, scale(p, kg)));
  };
  const year = Math.floor(s.timeYears + 1e-9);
  const deciduous = species.leaves.habit === 'deciduous';
  for (const c of Object.values(s.leafCohorts)) {
    const seg = s.segments[c.segmentId];
    // En 'initial', una caduca carga solo con el follaje de la temporada en curso.
    if (foliage === 'initial' && deciduous && Math.floor(c.bornAtYears + 1e-9) !== year) continue;
    const n = foliage === 'initial' ? c.count : popcount(c.attachedMask);
    if (seg && n > 0) addPoint(c.axisId, seg.end, n * MECH.leafMassKg, n * leafArea);
  }
  for (const f of Object.values(s.fruits)) {
    const seg = s.segments[f.segmentId];
    if (seg) addPoint(f.axisId, seg.end, f.massKg, 0);
  }
  // Acumulación de hojas a raíz (los hijos tienen id mayor que su padre).
  const ids = [...out.keys()].sort((a, b) => b - a);
  for (const id of ids) {
    const a = out.get(id)!;
    const p = a.parentAxisId !== null ? out.get(a.parentAxisId) : undefined;
    if (!p) continue;
    p.massKg += a.massKg;
    p.leafAreaM2 += a.leafAreaM2;
    moment.set(p.axisId, add(moment.get(p.axisId)!, moment.get(id)!));
  }
  const wMax = 2 * Math.PI * MECH.maxNaturalHz;
  for (const a of out.values()) {
    a.com = a.massKg > 0 ? scale(moment.get(a.axisId)!, 1 / a.massKg) : a.pivot;
    const lever = Math.max(length(sub(a.com, a.pivot)), 0.01);
    a.inertia = Math.max((a.massKg * lever * lever) / 3, a.stiffness / (wMax * wMax));
    a.damping = 2 * MECH.dampingRatio * Math.sqrt(a.stiffness * a.inertia);
  }
  return out;
}

/** Combadura estática por peso (vector de rotación, rad), acotada. */
export function staticBend(a: AxisMechanics): Vec3 {
  const torque = cross(sub(a.com, a.pivot), [0, -a.massKg * MECH.gravity, 0]);
  const theta = scale(torque, 1 / Math.max(a.stiffness, 1e-12));
  const mag = length(theta);
  return mag > MECH.maxStaticBendRad ? scale(theta, MECH.maxStaticBendRad / mag) : theta;
}
