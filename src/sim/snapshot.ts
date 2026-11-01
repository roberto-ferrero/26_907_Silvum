import { buildBarkMesh, type BarkMesh } from './bark-mesh.ts';
import { seasonName, seasonPhase } from './clock.ts';
import {
  hexToLinear,
  individualLeafForm,
  leafColor,
  leafPose,
  leafScale,
  leafTraits,
} from './leaves.ts';
import { AXIS_ROLES } from './morphotype.ts';
import { popcount } from './organs.ts';
import { phenophase } from './phenology.ts';
import { flowerOpenness, flowerPose, fruitColor, fruitPose } from './reproduction.ts';
import { getSpecies, type LeafForm } from './species.ts';
import type { TreeState } from './types.ts';
import type { WindSettings } from './wind.ts';

/**
 * Instantánea de dibujo: lo mínimo para representar el árbol (esqueleto, hojas, flores,
 * frutos y desprendimientos recientes), sin la historia botánica. Un entrenudo por instancia (stride en floats):
 *   0-2 inicio (m) · 3-5 fin (m) · 6 radio base (m) · 7 radio punta (m) · 8 papel (índice)
 *   9 madera muerta (0/1) · 10 edad del entrenudo (años)
 */
export const SNAPSHOT_STRIDE = 11;

/**
 * Órganos instanciados (hojas, flores, frutos), stride en floats:
 *   0-2 posición (m) · 3-6 cuaternión (x, y, z, w) · 7 escala (m) · 8-10 color lineal
 *   11 entrenudo portador (id; el rig de presentación lo usa para deformar el órgano)
 */
export const ORGAN_STRIDE = 12;

export interface OrganBuffers {
  count: number;
  data: Float32Array;
}

export interface RenderSnapshot {
  stateRevision: number;
  timeYears: number;
  seasonPhase: number;
  season: string;
  developmentalStage01: number;
  segmentCount: number;
  livingAxes: number;
  deadAxes: number;
  liveBuds: number;
  capacityReached: boolean;
  segments: Float32Array;
  speciesId: string;
  speciesName: string;
  seed: number;
  phenophase: string;
  wind: WindSettings;
  /** Forma de hoja del individuo (la geometría se construye una vez por árbol). */
  leafForm: LeafForm;
  leaves: OrganBuffers;
  flowers: OrganBuffers;
  fruits: OrganBuffers;
  /** Masa total de frutos colgando (kg), para la carga del rig. */
  fruitMassKg: number;
  /** Desprendimientos desde la publicación anterior (ver `DETACH_STRIDE`). */
  detachments: Float32Array;
  /** Malla continua de corteza (tubos por eje). */
  bark: BarkMesh;
  /**
   * Reloj de las partículas y de la descomposición en el suelo (años). Es el tiempo
   * biológico salvo con el ciclo de hojas independiente, que lleva su propio reloj.
   */
  clockYears: number;
  /** Fase del año que muestra el follaje (la biológica o la del ciclo de hojas). */
  foliagePhase: number;
  /** Últimos eventos del motor, legibles (panel de diagnóstico). */
  recentEvents: string[];
  /** Yemas vivas para el mapa de luz: x, y, z, exposición [0, 1] (4 floats). */
  budLight: Float32Array;
}

const EVENT_NAMES: Record<string, string> = {
  'bud-activated': 'yema activada',
  'axis-born': 'nace eje',
  'axis-died': 'muere eje',
  'axis-shed': 'cae rama',
  'capacity-reached': 'capacidad alcanzada',
  'environment-changed': 'cambio de entorno',
  'leader-lost': 'pierde el líder',
};

function recentEvents(s: TreeState, n = 14): string[] {
  return s.events
    .slice(-n)
    .reverse()
    .map((e) => {
      const name = EVENT_NAMES[e.kind] ?? e.kind;
      return `${e.timeYears.toFixed(2)}  ${name} #${e.id}${e.detail ? ` (${e.detail})` : ''}`;
    });
}

function budLight(s: TreeState): Float32Array {
  const live = Object.values(s.buds).filter(
    (b) => b.state !== 'dead' && b.segmentId !== null && s.axes[b.axisId]?.woodState === 'living',
  );
  const out = new Float32Array(live.length * 4);
  live.forEach((b, i) => {
    const seg = s.segments[b.segmentId!];
    if (!seg) return;
    out.set([seg.end[0], seg.end[1], seg.end[2], b.exposure01], i * 4);
  });
  return out;
}

function writeOrgan(
  data: Float32Array,
  n: number,
  pose: Float32Array,
  size: number,
  rgb: readonly [number, number, number],
  segmentId: number,
): void {
  const o = n * ORGAN_STRIDE;
  data.set(pose, o);
  data[o + 7] = size;
  data[o + 8] = rgb[0];
  data[o + 9] = rgb[1];
  data[o + 10] = rgb[2];
  data[o + 11] = segmentId;
}

const pose = new Float32Array(7);

function buildLeaves(s: TreeState): OrganBuffers {
  const species = getSpecies(s.speciesId);
  let total = 0;
  for (const c of Object.values(s.leafCohorts)) total += popcount(c.attachedMask);
  const data = new Float32Array(total * ORGAN_STRIDE);
  let n = 0;
  for (const c of Object.values(s.leafCohorts)) {
    if (c.attachedMask === 0) continue;
    const seg = s.segments[c.segmentId];
    if (!seg) continue;
    const traits = leafTraits(s.seed, c.id, c.count);
    for (let i = 0; i < c.count; i++) {
      if (!((c.attachedMask >>> i) & 1)) continue;
      leafPose(species, seg, c, traits, i, pose, 0);
      writeOrgan(
        data,
        n++,
        pose,
        leafScale(species, c, traits, i, s.timeYears),
        leafColor(species, c, traits, i, s.timeYears),
        c.segmentId,
      );
    }
  }
  return { count: n, data: data.subarray(0, n * ORGAN_STRIDE) };
}

function buildFlowers(s: TreeState): OrganBuffers {
  const program = getSpecies(s.speciesId).flowering;
  if (!program) return { count: 0, data: new Float32Array(0) };
  const t = s.timeYears;
  const cohorts = Object.values(s.flowerCohorts).filter(
    (c) => !c.done && t >= c.bloomYear + program.bloom[0] - 0.08,
  );
  const data = new Float32Array(cohorts.reduce((a, c) => a + c.count, 0) * ORGAN_STRIDE);
  const bud = hexToLinear(program.colors.bud);
  const petal = hexToLinear(program.colors.petal);
  let n = 0;
  for (const c of cohorts) {
    const seg = s.segments[c.segmentId];
    if (!seg) continue;
    for (let i = 0; i < c.count; i++) {
      const open = flowerOpenness(program, s.seed, c, i, t);
      if (open <= 0) continue;
      flowerPose(s.seed, seg, c, i, program.sizeM, pose, 0);
      const k = (open - 0.3) / 0.7;
      const rgb: [number, number, number] = [
        bud[0] + (petal[0] - bud[0]) * k,
        bud[1] + (petal[1] - bud[1]) * k,
        bud[2] + (petal[2] - bud[2]) * k,
      ];
      writeOrgan(data, n++, pose, program.sizeM * open, rgb, c.segmentId);
    }
  }
  return { count: n, data: data.subarray(0, n * ORGAN_STRIDE) };
}

function buildFruits(s: TreeState): { buffers: OrganBuffers; massKg: number } {
  const program = getSpecies(s.speciesId).fruiting;
  const fruits = Object.values(s.fruits);
  if (!program || fruits.length === 0) {
    return { buffers: { count: 0, data: new Float32Array(0) }, massKg: 0 };
  }
  const data = new Float32Array(fruits.length * ORGAN_STRIDE);
  let n = 0;
  let mass = 0;
  for (const f of fruits) {
    const seg = s.segments[f.segmentId];
    if (!seg) continue;
    fruitPose(s.seed, seg, f, pose, 0);
    writeOrgan(
      data,
      n++,
      pose,
      program.sizeM * (0.25 + 0.75 * f.growth01),
      fruitColor(program, f, s.timeYears),
      f.segmentId,
    );
    mass += f.massKg;
  }
  return { buffers: { count: n, data: data.subarray(0, n * ORGAN_STRIDE) }, massKg: mass };
}

export function buildRenderSnapshot(
  s: TreeState,
  detachments: Float32Array = new Float32Array(0),
): RenderSnapshot {
  const segs = Object.values(s.segments);
  const data = new Float32Array(segs.length * SNAPSHOT_STRIDE);
  let n = 0;
  for (const seg of segs) {
    const axis = s.axes[seg.axisId];
    if (!axis || axis.woodState === 'detached') continue;
    // Radio en la punta: el del entrenudo que continúa el eje o, si es terminal, el propio afinado.
    const next = seg.childSegmentIds
      .map((id) => s.segments[id])
      .find((c) => c !== undefined && c.axisId === seg.axisId);
    const tipRadius = next ? next.radiusM : seg.radiusM * 0.85;
    const o = n * SNAPSHOT_STRIDE;
    data[o] = seg.start[0];
    data[o + 1] = seg.start[1];
    data[o + 2] = seg.start[2];
    data[o + 3] = seg.end[0];
    data[o + 4] = seg.end[1];
    data[o + 5] = seg.end[2];
    data[o + 6] = seg.radiusM;
    data[o + 7] = Math.min(seg.radiusM, tipRadius);
    data[o + 8] = AXIS_ROLES.indexOf(axis.role);
    data[o + 9] = axis.woodState === 'deadRetained' ? 1 : 0;
    data[o + 10] = s.timeYears - seg.bornAtYears;
    n++;
  }
  let livingAxes = 0;
  let deadAxes = 0;
  for (const a of Object.values(s.axes)) {
    if (a.woodState === 'living') livingAxes++;
    else if (a.woodState === 'deadRetained') deadAxes++;
  }
  let liveBuds = 0;
  for (const b of Object.values(s.buds)) if (b.state !== 'dead') liveBuds++;
  const phase = seasonPhase(s.timeYears);
  const species = getSpecies(s.speciesId);
  const fruits = buildFruits(s);
  return {
    stateRevision: s.stateRevision,
    timeYears: s.timeYears,
    seasonPhase: phase,
    season: seasonName(phase),
    developmentalStage01: s.developmentalStage01,
    segmentCount: n,
    livingAxes,
    deadAxes,
    liveBuds,
    capacityReached: s.capacityReached,
    segments: data.subarray(0, n * SNAPSHOT_STRIDE),
    speciesId: s.speciesId,
    speciesName: species.name,
    seed: s.seed,
    phenophase: phenophase(
      {
        calendar: species.phenology,
        deciduous: species.leaves.habit === 'deciduous',
        bloom: species.flowering?.petals ? species.flowering.bloom : null,
      },
      phase,
    ),
    wind: { ...s.environment.wind },
    leafForm: individualLeafForm(species, s.seed),
    leaves: buildLeaves(s),
    flowers: buildFlowers(s),
    fruits: fruits.buffers,
    fruitMassKg: fruits.massKg,
    detachments,
    bark: buildBarkMesh(s),
    clockYears: s.timeYears,
    foliagePhase: phase,
    recentEvents: recentEvents(s),
    budLight: budLight(s),
  };
}
