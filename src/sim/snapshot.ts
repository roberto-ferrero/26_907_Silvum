import { seasonName, seasonPhase } from './clock.ts';
import { AXIS_ROLES } from './morphotype.ts';
import type { TreeState } from './types.ts';

/**
 * Instantánea de dibujo: lo mínimo para representar el esqueleto, sin la historia
 * botánica. Un entrenudo por instancia (stride en floats):
 *   0-2 inicio (m) · 3-5 fin (m) · 6 radio base (m) · 7 radio punta (m) · 8 papel (índice)
 *   9 madera muerta (0/1) · 10 edad del entrenudo (años)
 */
export const SNAPSHOT_STRIDE = 11;

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
}

export function buildRenderSnapshot(s: TreeState): RenderSnapshot {
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
  };
}
