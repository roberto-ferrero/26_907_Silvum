import { describe, expect, it } from 'vitest';
import { buildBarkMesh } from '../src/sim/bark-mesh.ts';
import { TreeSimulation } from '../src/sim/tree.ts';

describe('malla de corteza', () => {
  it('es finita, indexa dentro de rango y no altera el estado', () => {
    const sim = new TreeSimulation({ speciesId: 'quercus-robur', seed: 5 });
    sim.advanceYears(12.5);
    const before = JSON.stringify(sim.state);
    const mesh = buildBarkMesh(sim.state);
    expect(JSON.stringify(sim.state)).toBe(before);
    const vertices = mesh.positions.length / 3;
    expect(vertices).toBeGreaterThan(100);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.colors.length).toBe(mesh.positions.length);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
    expect(mesh.indices.every((i) => i < vertices)).toBe(true);
  });

  it('el cuello del tronco se ensancha sobre el sustrato', () => {
    const sim = new TreeSimulation({ speciesId: 'quercus-robur', seed: 5 });
    sim.advanceYears(20.5);
    const mesh = buildBarkMesh(sim.state);
    const trunk = Object.values(sim.state.axes).find((a) => a.parentAxisId === null)!;
    const base = sim.state.segments[trunk.segmentIds[0]!]!;
    let maxBaseR = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (Math.abs(mesh.positions[i + 1]!) < 0.002) {
        maxBaseR = Math.max(maxBaseR, Math.hypot(mesh.positions[i]!, mesh.positions[i + 2]!));
      }
    }
    expect(maxBaseR).toBeGreaterThan(base.radiusM * 1.4);
  });
});
