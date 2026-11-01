/**
 * Malla continua de corteza (adelanto de la fase 6.1): un tubo por eje que recorre sus
 * entrenudos con transporte paralelo del marco y un anillo por nudo, de modo que el radio
 * se afina sin escalones. Cada lateral nace dentro del tubo de su portador (la unión aún
 * no es una pieza propia; llegará en 6.2). Se construye en el Worker y se transfiere.
 * Solo dibujo: no altera el estado biológico.
 */
import { axisMechanics } from './mechanics.ts';
import { eventSigned, eventUniform, smoothNoise1D } from './random.ts';
import { getSpecies } from './species.ts';
import type { TreeState } from './types.ts';
import { add, cross, dot, normalizeOr, scale, sub, transportNormal, type Vec3 } from './vec3.ts';

export interface BarkMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Color lineal por vértice. */
  colors: Float32Array;
  /**
   * Coordenadas de corteza en metros (u alrededor, v a lo largo del eje) y madurez de la
   * corteza [0, 1] (lisa en ramillas, agrietada en el tronco viejo), para el material (6.3).
   */
  barkUv: Float32Array;
  barkAge: Float32Array;
  indices: Uint32Array;
  /** Esqueleto para el rig de presentación (fase 5). */
  rig: RigData;
}

/**
 * Esqueleto del rig: un nudo por anillo de la corteza. Los ejes van en orden de id (el
 * padre antes que sus hijos). El nudo 0 de cada eje es su inserción en el portador.
 */
export interface RigData {
  /** Posición de reposo de cada nudo (3 floats). */
  nodeRest: Float32Array;
  /** Entrenudo que termina en el nudo (-1 en la inserción). */
  nodeSegment: Int32Array;
  /** Nudo al que pertenece cada vértice de la corteza. */
  vertexNode: Uint32Array;
  /** Id de cada eje (para conservar su estado dinámico entre publicaciones). */
  axisId: Int32Array;
  axisFirstNode: Uint32Array;
  axisNodeCount: Uint32Array;
  /** Nudo del portador donde se inserta el eje (-1 en el tronco). */
  axisParentNode: Int32Array;
  axisStiffness: Float32Array;
  axisInertia: Float32Array;
  axisDamping: Float32Array;
  axisMassKg: Float32Array;
  axisLeafAreaM2: Float32Array;
  /** Centro de masas del subárbol (3 floats por eje). */
  axisCom: Float32Array;
}

const srgb = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = (h: number): [number, number, number] => [
  srgb(((h >> 16) & 255) / 255),
  srgb(((h >> 8) & 255) / 255),
  srgb((h & 255) / 255),
];
/** Corteza vieja (gris pardo agrietado), ramilla joven (parda rojiza) y madera muerta. */
const OLD_BARK = hex(0x857a6e);
const YOUNG_BARK = hex(0x8c6d52);
const DEAD_WOOD = hex(0x8f8a80);

/** Altura (m) y exceso de radio del ensanchamiento basal del tronco. */
const FLARE_HEIGHT_M = 0.07;
const FLARE = 0.7;

function sidesFor(radiusM: number): number {
  if (radiusM > 0.012) return 12;
  if (radiusM > 0.004) return 8;
  return 5;
}

export function buildBarkMesh(s: TreeState): BarkMesh {
  // Primera pasada: tamaño exacto de los búferes.
  const axes = Object.values(s.axes).filter(
    (a) => a.woodState !== 'detached' && a.segmentIds.some((id) => s.segments[id]),
  );
  let vertexCount = 0;
  let indexCount = 0;
  const plans: { segIds: number[]; sides: number }[] = [];
  for (const axis of axes) {
    const segIds = axis.segmentIds.filter((id) => s.segments[id] !== undefined);
    const sides = sidesFor(s.segments[segIds[0]!]!.radiusM);
    const rings = segIds.length + 1;
    vertexCount += rings * (sides + 1);
    indexCount += (rings - 1) * sides * 6;
    plans.push({ segIds, sides });
  }
  // Nebari (6.5): raíces superficiales visuales que crecen con el grosor del tronco.
  const roots = planRoots(s);
  for (const root of roots) {
    vertexCount += root.points.length * (ROOT_SIDES + 1);
    indexCount += (root.points.length - 1) * ROOT_SIDES * 6;
  }
  const nodeCount = plans.reduce((n, p) => n + p.segIds.length + 1, 0);
  const mech = axisMechanics(s, getSpecies(s.speciesId));
  const rig: RigData = {
    nodeRest: new Float32Array(nodeCount * 3),
    nodeSegment: new Int32Array(nodeCount),
    vertexNode: new Uint32Array(vertexCount),
    axisId: new Int32Array(axes.length),
    axisFirstNode: new Uint32Array(axes.length),
    axisNodeCount: new Uint32Array(axes.length),
    axisParentNode: new Int32Array(axes.length),
    axisStiffness: new Float32Array(axes.length),
    axisInertia: new Float32Array(axes.length),
    axisDamping: new Float32Array(axes.length),
    axisMassKg: new Float32Array(axes.length),
    axisLeafAreaM2: new Float32Array(axes.length),
    axisCom: new Float32Array(axes.length * 3),
  };
  /** Nudo en el que termina cada entrenudo (para insertar los hijos). */
  const endNode = new Map<number, number>();
  let node = 0;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const barkUv = new Float32Array(vertexCount * 2);
  const barkAge = new Float32Array(vertexCount);
  const indices = new Uint32Array(indexCount);

  let v = 0;
  let ix = 0;
  for (let a = 0; a < axes.length; a++) {
    const axis = axes[a]!;
    const { segIds, sides } = plans[a]!;
    const dead = axis.woodState === 'deadRetained';
    const segs = segIds.map((id) => s.segments[id]!);
    const base = v;
    const m = mech.get(axis.id);
    rig.axisId[a] = axis.id;
    rig.axisFirstNode[a] = node;
    rig.axisNodeCount[a] = segs.length + 1;
    rig.axisParentNode[a] =
      axis.parentSegmentId !== null ? (endNode.get(axis.parentSegmentId) ?? -1) : -1;
    rig.axisStiffness[a] = m?.stiffness ?? 1;
    rig.axisInertia[a] = m?.inertia ?? 1;
    rig.axisDamping[a] = m?.damping ?? 1;
    rig.axisMassKg[a] = m?.massKg ?? 0;
    rig.axisLeafAreaM2[a] = m?.leafAreaM2 ?? 0;
    const com = m?.com ?? segs[0]!.start;
    rig.axisCom.set(com, a * 3);
    let frame = segs[0]!.frameU;
    let tangent = segs[0]!.direction;
    // Arco recorrido a lo largo del eje (coordenada v de la corteza).
    let arc = 0;
    for (let r = 0; r <= segs.length; r++) {
      const seg = segs[Math.min(r, segs.length - 1)]!;
      const next = segs[r];
      // Tangente del anillo: media de los entrenudos que se unen en el nudo (sin quiebros).
      const t: Vec3 =
        r === 0
          ? seg.direction
          : r === segs.length
            ? seg.direction
            : normalizeOr(add(segs[r - 1]!.direction, seg.direction), seg.direction);
      frame = transportNormal(frame, tangent, t);
      tangent = t;
      const center = r === segs.length ? seg.end : seg.start;
      if (r > 0) arc += segs[r - 1]!.lengthM;
      // Madurez de la corteza: se agrieta con el grosor (y por tanto con la edad).
      const maturity = Math.max(0, Math.min(1, (seg.radiusM - 0.003) / 0.02));
      rig.nodeRest.set(center, node * 3);
      rig.nodeSegment[node] = r === 0 ? -1 : segIds[r - 1]!;
      if (r > 0) endNode.set(segIds[r - 1]!, node);
      let radius =
        r === segs.length ? seg.radiusM * 0.7 : Math.max(next ? next.radiusM : seg.radiusM, 1e-5);
      // Ensanchamiento del cuello del tronco sobre el sustrato (nebari visual).
      if (axis.parentAxisId === null && center[1] < FLARE_HEIGHT_M) {
        const f = 1 - center[1] / FLARE_HEIGHT_M;
        radius *= 1 + FLARE * f * f;
      }
      const u = normalizeOr(sub(frame, scale(t, dot(frame, t))), frame);
      const w = cross(t, u);
      // Color: mezcla de corteza joven a vieja con el radio.
      const k = Math.min(1, radius / 0.012);
      const c = dead
        ? DEAD_WOOD
        : ([
            YOUNG_BARK[0] + (OLD_BARK[0] - YOUNG_BARK[0]) * k,
            YOUNG_BARK[1] + (OLD_BARK[1] - YOUNG_BARK[1]) * k,
            YOUNG_BARK[2] + (OLD_BARK[2] - YOUNG_BARK[2]) * k,
          ] as const);
      for (let j = 0; j <= sides; j++) {
        const ang = (j / sides) * Math.PI * 2;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const nx = u[0] * ca + w[0] * sa;
        const ny = u[1] * ca + w[1] * sa;
        const nz = u[2] * ca + w[2] * sa;
        const o = v * 3;
        positions[o] = center[0] + nx * radius;
        positions[o + 1] = center[1] + ny * radius;
        positions[o + 2] = center[2] + nz * radius;
        normals[o] = nx;
        normals[o + 1] = ny;
        normals[o + 2] = nz;
        // Ligero veteado longitudinal para que la corteza no sea plana.
        const grain = 0.88 + 0.12 * Math.abs(Math.sin(ang * 3 + r * 0.7));
        colors[o] = c[0] * grain;
        colors[o + 1] = c[1] * grain;
        colors[o + 2] = c[2] * grain;
        rig.vertexNode[v] = node;
        barkUv[v * 2] = (j / sides) * 2 * Math.PI * Math.max(radius, 0.002);
        barkUv[v * 2 + 1] = arc;
        barkAge[v] = dead ? 0.3 : maturity;
        v++;
      }
      node++;
    }
    for (let r = 0; r < segs.length; r++) {
      for (let j = 0; j < sides; j++) {
        const a0 = base + r * (sides + 1) + j;
        const b0 = a0 + sides + 1;
        // Orden antihorario visto desde fuera: la cara frontal es la exterior del tubo.
        indices[ix++] = a0;
        indices[ix++] = a0 + 1;
        indices[ix++] = b0;
        indices[ix++] = a0 + 1;
        indices[ix++] = b0 + 1;
        indices[ix++] = b0;
      }
    }
  }
  // Raíces: tubos rígidos unidos al nudo de la base del tronco (no se mecen).
  for (const root of roots) {
    const base = v;
    let frame: Vec3 = [0, 1, 0];
    let tangent: Vec3 = root.dirs[0]!;
    let arc = 0;
    for (let k = 0; k < root.points.length; k++) {
      const center = root.points[k]!;
      const t = root.dirs[k]!;
      frame = transportNormal(frame, tangent, t);
      tangent = t;
      if (k > 0) arc += Math.hypot(...sub(center, root.points[k - 1]!));
      const u = normalizeOr(sub(frame, scale(t, dot(frame, t))), [0, 1, 0]);
      const w = cross(t, u);
      const radius = root.radii[k]!;
      for (let j = 0; j <= ROOT_SIDES; j++) {
        const ang = (j / ROOT_SIDES) * Math.PI * 2;
        const nx = u[0] * Math.cos(ang) + w[0] * Math.sin(ang);
        const ny = u[1] * Math.cos(ang) + w[1] * Math.sin(ang);
        const nz = u[2] * Math.cos(ang) + w[2] * Math.sin(ang);
        const o = v * 3;
        positions[o] = center[0] + nx * radius;
        // Aplastada contra el sustrato: más ancha que alta.
        positions[o + 1] = center[1] + ny * radius * 0.6;
        positions[o + 2] = center[2] + nz * radius;
        normals[o] = nx;
        normals[o + 1] = ny;
        normals[o + 2] = nz;
        colors.set(OLD_BARK, o);
        rig.vertexNode[v] = 0;
        barkUv[v * 2] = (j / ROOT_SIDES) * 2 * Math.PI * radius;
        barkUv[v * 2 + 1] = arc;
        barkAge[v] = 0.8;
        v++;
      }
    }
    for (let k = 0; k < root.points.length - 1; k++) {
      for (let j = 0; j < ROOT_SIDES; j++) {
        const a0 = base + k * (ROOT_SIDES + 1) + j;
        const b0 = a0 + ROOT_SIDES + 1;
        indices[ix++] = a0;
        indices[ix++] = a0 + 1;
        indices[ix++] = b0;
        indices[ix++] = a0 + 1;
        indices[ix++] = b0 + 1;
        indices[ix++] = b0;
      }
    }
  }
  return { positions, normals, colors, barkUv, barkAge, indices, rig };
}

const ROOT_SIDES = 7;
/** Alcance máximo de una raíz desde el eje del tronco (m): no sale de la maceta. */
const ROOT_MAX_REACH_M = 0.15;
const ROOT_ORGAN = 0xffff_ff00;

interface RootPlan {
  points: Vec3[];
  dirs: Vec3[];
  radii: number[];
}

/**
 * Raíces del nebari: de 4 a 7 por individuo, repartidas en azimut con variación, que
 * salen del cuello del tronco, serpentean sobre el sustrato y se hunden en él.
 * Longitud y grosor proporcionales al radio del tronco (crecen con el árbol).
 */
function planRoots(s: TreeState): RootPlan[] {
  const trunk = Object.values(s.axes).find((a) => a.parentAxisId === null);
  const first = trunk ? s.segments[trunk.segmentIds[0] ?? -1] : undefined;
  if (!first || first.radiusM < 0.004) return [];
  const r0 = first.radiusM * (1 + FLARE);
  const count = 4 + Math.floor(eventUniform(s.seed, ROOT_ORGAN, 0, 0) * 4);
  const base = eventUniform(s.seed, ROOT_ORGAN, 1, 0) * Math.PI * 2;
  const out: RootPlan[] = [];
  const steps = 9;
  for (let i = 0; i < count; i++) {
    const az0 = base + (i * 2 * Math.PI) / count + 0.5 * eventSigned(s.seed, ROOT_ORGAN, 10 + i, 0);
    // Dentro del sustrato de la maceta (≈ 0,15 m desde el tronco en la dirección corta).
    const length = Math.min(
      ROOT_MAX_REACH_M - r0 * 0.55,
      r0 * (1.6 + 1.2 * eventUniform(s.seed, ROOT_ORGAN, 20 + i, 0)),
    );
    const thick = r0 * (0.32 + 0.18 * eventUniform(s.seed, ROOT_ORGAN, 30 + i, 0));
    const points: Vec3[] = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const az = az0 + 0.35 * smoothNoise1D(s.seed, ROOT_ORGAN + 1 + i, t * 3, 1);
      const dist = r0 * 0.55 + t * length;
      const y = 0.012 * (1 - t) - 0.006 * t * t;
      points.push([Math.cos(az) * dist, y, Math.sin(az) * dist]);
    }
    const dirs = points.map((p, k) =>
      normalizeOr(sub(points[Math.min(k + 1, steps)]!, points[Math.max(k - 1, 0)]!), [1, 0, 0]),
    );
    const radii = points.map((_, k) => thick * (1 - k / steps) ** 1.3 + 0.0006);
    out.push({ points, dirs, radii });
  }
  return out;
}
