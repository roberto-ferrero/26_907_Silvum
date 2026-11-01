/**
 * Malla continua de corteza (adelanto de la fase 6.1): un tubo por eje que recorre sus
 * entrenudos con transporte paralelo del marco y un anillo por nudo, de modo que el radio
 * se afina sin escalones. Cada lateral nace dentro del tubo de su portador (la unión aún
 * no es una pieza propia; llegará en 6.2). Se construye en el Worker y se transfiere.
 * Solo dibujo: no altera el estado biológico.
 */
import type { TreeState } from './types.ts';
import { add, cross, dot, normalizeOr, scale, sub, transportNormal, type Vec3 } from './vec3.ts';

export interface BarkMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Color lineal por vértice. */
  colors: Float32Array;
  indices: Uint32Array;
}

const srgb = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = (h: number): [number, number, number] => [
  srgb(((h >> 16) & 255) / 255),
  srgb(((h >> 8) & 255) / 255),
  srgb((h & 255) / 255),
];
/** Corteza vieja (gris pardo agrietado), ramilla joven (parda rojiza) y madera muerta. */
const OLD_BARK = hex(0x5b4d42);
const YOUNG_BARK = hex(0x7a5c45);
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
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);

  let v = 0;
  let ix = 0;
  for (let a = 0; a < axes.length; a++) {
    const axis = axes[a]!;
    const { segIds, sides } = plans[a]!;
    const dead = axis.woodState === 'deadRetained';
    const segs = segIds.map((id) => s.segments[id]!);
    const base = v;
    let frame = segs[0]!.frameU;
    let tangent = segs[0]!.direction;
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
        v++;
      }
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
  return { positions, normals, colors, indices };
}
