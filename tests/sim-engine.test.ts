import { describe, expect, it } from 'vitest';
import { buildRenderSnapshot, SNAPSHOT_STRIDE } from '../src/sim/snapshot.ts';
import { TreeSimulation, createTreeState } from '../src/sim/tree.ts';
import type { TreeState } from '../src/sim/types.ts';
import { listArchetypes } from '../src/sim/morphotype.ts';

function grow(archetypeId: string, seed: number, years: number): TreeSimulation {
  const sim = new TreeSimulation({ archetypeId, seed });
  sim.advanceYears(years);
  return sim;
}

function checkStructure(s: TreeState): void {
  for (const seg of Object.values(s.segments)) {
    // Grafo enraizado sin ciclos: el padre existe y nació antes (id menor).
    if (seg.parentSegmentId !== null) {
      const parent = s.segments[seg.parentSegmentId];
      expect(parent).toBeDefined();
      expect(seg.parentSegmentId).toBeLessThan(seg.id);
      expect(parent!.childSegmentIds).toContain(seg.id);
    }
    expect(s.axes[seg.axisId]?.segmentIds).toContain(seg.id);
    for (const v of [...seg.start, ...seg.end, seg.radiusM, seg.lengthM]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(seg.radiusM).toBeGreaterThan(0);
  }
  for (const bud of Object.values(s.buds)) {
    expect(s.axes[bud.axisId]).toBeDefined();
    if (bud.segmentId !== null) expect(s.segments[bud.segmentId]).toBeDefined();
  }
}

describe('motor de crecimiento', () => {
  it('crece y ramifica en todos los arquetipos', () => {
    for (const { id } of listArchetypes()) {
      const sim = grow(id, 11, 8);
      const s = sim.state;
      expect(Object.keys(s.segments).length).toBeGreaterThan(20);
      expect(Object.values(s.axes).filter((a) => a.woodState === 'living').length).toBeGreaterThan(
        2,
      );
      checkStructure(s);
    }
  });

  it('es determinista con la misma semilla y distinto con otra', () => {
    const a = grow('broad-crown-broadleaf', 5, 10).state;
    const b = grow('broad-crown-broadleaf', 5, 10).state;
    const c = grow('broad-crown-broadleaf', 6, 10).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('reanudar desde una instantánea da el mismo resultado (replay)', () => {
    const sim = grow('conical-conifer', 3, 6);
    const snapshot = structuredClone(sim.state);
    sim.advanceYears(3);
    const resumed = new TreeSimulation({ state: snapshot });
    resumed.advanceYears(3);
    expect(JSON.stringify(resumed.state)).toBe(JSON.stringify(sim.state));
  });

  it('los radios de la madera retenida nunca decrecen', () => {
    const sim = grow('pendulous-tree', 2, 6);
    const before = new Map(Object.values(sim.state.segments).map((g) => [g.id, g.radiusM]));
    sim.advanceYears(2);
    for (const [id, r] of before) {
      const seg = sim.state.segments[id];
      if (seg) expect(seg.radiusM).toBeGreaterThanOrEqual(r);
    }
  });

  it('las longitudes maduras se conservan', () => {
    const sim = grow('broad-crown-broadleaf', 4, 5);
    const mature = Object.values(sim.state.segments).map((g) => [g.id, g.lengthM] as const);
    sim.advanceYears(2);
    for (const [id, len] of mature) {
      const seg = sim.state.segments[id];
      if (seg) expect(seg.lengthM).toBe(len);
    }
  });

  it('respeta la capacidad y lo registra en vez de escribir fuera de ella', () => {
    const sim = new TreeSimulation({
      archetypeId: 'broad-crown-broadleaf',
      seed: 1,
      limits: { maxSegments: 50, maxBuds: 10000, maxEvents: 100 },
    });
    sim.advanceYears(8);
    expect(Object.keys(sim.state.segments).length).toBeLessThanOrEqual(50);
    expect(sim.state.capacityReached).toBe(true);
    expect(sim.state.events.some((e) => e.kind === 'capacity-reached')).toBe(true);
  });

  it('el estado inicial es una semilla con una yema terminal', () => {
    const s = createTreeState('columnar-tree', 9);
    expect(Object.keys(s.axes)).toHaveLength(1);
    expect(Object.keys(s.buds)).toHaveLength(1);
    expect(Object.keys(s.segments)).toHaveLength(0);
  });
});

describe('instantánea de dibujo', () => {
  it('no modifica el estado biológico', () => {
    const sim = grow('parasol-pine', 8, 6);
    const before = JSON.stringify(sim.state);
    const snap = buildRenderSnapshot(sim.state);
    expect(JSON.stringify(sim.state)).toBe(before);
    expect(snap.segments.length).toBe(snap.segmentCount * SNAPSHOT_STRIDE);
    expect(snap.segments.every(Number.isFinite)).toBe(true);
  });
});
