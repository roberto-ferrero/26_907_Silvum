import type { TreeState } from '../src/sim/types.ts';

/**
 * Métricas de silueta para comparar con el canon de una especie (madera viva):
 * altura, anchura de copa (percentiles 2-98 en x y z), base de la copa y altura del
 * líder (fracciones de la altura), ramas madre y tortuosidad media de ejes largos.
 */
export interface CrownMetrics {
  heightM: number;
  widthM: number;
  widthToHeight: number;
  /** Inserción de la rama lateral viva más baja con longitud > 8 % de la altura. */
  crownBase01: number;
  /** Punta del tronco original / altura (1 = líder dominante, excurrente). */
  leaderTop01: number;
  /** Laterales del tronco con radio de base ≥ 45 % del portador. */
  scaffolds: number;
  /** Longitud del eje / cuerda, media de los ejes de ≥ 8 entrenudos. */
  tortuosity: number;
}

export function crownMetrics(s: TreeState): CrownMetrics {
  const segs = Object.values(s.segments).filter((g) => s.axes[g.axisId]?.woodState === 'living');
  let height = 0;
  for (const g of segs) height = Math.max(height, g.end[1]);
  const pct = (values: number[], p: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(p * (sorted.length - 1))]!;
  };
  const xs = segs.map((g) => g.end[0]);
  const zs = segs.map((g) => g.end[2]);
  const width = (pct(xs, 0.98) - pct(xs, 0.02) + (pct(zs, 0.98) - pct(zs, 0.02))) / 2;

  const trunk = Object.values(s.axes).find((a) => a.parentAxisId === null)!;
  let trunkTop = 0;
  for (const id of trunk.segmentIds) trunkTop = Math.max(trunkTop, s.segments[id]?.end[1] ?? 0);

  const axisLength = new Map<number, number>();
  for (const g of segs) axisLength.set(g.axisId, (axisLength.get(g.axisId) ?? 0) + g.lengthM);
  let crownBase = height;
  let scaffolds = 0;
  for (const a of Object.values(s.axes)) {
    if (a.parentAxisId === null || a.woodState !== 'living') continue;
    const first = s.segments[a.segmentIds[0] ?? -1];
    if (!first) continue;
    if ((axisLength.get(a.id) ?? 0) > 0.08 * height) {
      crownBase = Math.min(crownBase, first.start[1]);
    }
    const carrier = a.parentSegmentId !== null ? s.segments[a.parentSegmentId] : undefined;
    if (a.parentAxisId === trunk.id && carrier && first.radiusM >= 0.45 * carrier.radiusM) {
      scaffolds++;
    }
  }

  let tortuositySum = 0;
  let tortuosityCount = 0;
  for (const a of Object.values(s.axes)) {
    if (a.woodState !== 'living' || a.segmentIds.length < 8) continue;
    const gs = a.segmentIds.map((id) => s.segments[id]!);
    const path = gs.reduce((sum, g) => sum + g.lengthM, 0);
    const p0 = gs[0]!.start;
    const p1 = gs[gs.length - 1]!.end;
    const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    tortuositySum += path / Math.max(1e-9, chord);
    tortuosityCount++;
  }

  return {
    heightM: height,
    widthM: width,
    widthToHeight: width / height,
    crownBase01: crownBase / height,
    leaderTop01: trunkTop / height,
    scaffolds,
    tortuosity: tortuosityCount > 0 ? tortuositySum / tortuosityCount : 1,
  };
}
