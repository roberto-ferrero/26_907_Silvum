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
    expect(mesh.barkUv.length).toBe(vertices * 2);
    expect(mesh.barkAge.every((a) => a >= 0 && a <= 1)).toBe(true);
  });

  it('las caras frontales miran hacia fuera del tubo', () => {
    const sim = new TreeSimulation({ speciesId: 'quercus-robur', seed: 5 });
    sim.advanceYears(8.5);
    const { positions: p, normals: n, indices } = buildBarkMesh(sim.state);
    const v = (i: number): [number, number, number] => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
    let outward = 0;
    let total = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const [a, b, c] = [indices[t]!, indices[t + 1]!, indices[t + 2]!];
      const [pa, pb, pc] = [v(a), v(b), v(c)];
      const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const face = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const dot = face[0]! * n[a * 3]! + face[1]! * n[a * 3 + 1]! + face[2]! * n[a * 3 + 2]!;
      if (Math.hypot(face[0]!, face[1]!, face[2]!) < 1e-14) continue;
      total++;
      if (dot > 0) outward++;
    }
    // Orden antihorario visto desde fuera (lo que three.js toma como cara frontal).
    expect(outward / total).toBeGreaterThan(0.99);
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
