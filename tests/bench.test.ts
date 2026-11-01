import { describe, expect, it } from 'vitest';
import { buildBarkMesh } from '../src/sim/bark-mesh.ts';
import { buildRenderSnapshot } from '../src/sim/snapshot.ts';
import { TreeSimulation } from '../src/sim/tree.ts';

/**
 * Banco de rendimiento (fase 9.2): `npm run bench` (con `npm test` se omite). Mide, en
 * árboles de 30 años, el coste de un año simulado, de una instantánea de dibujo y de la
 * malla de corteza, y lo imprime como tabla para comparar entre equipos.
 */
const SPECIES = ['quercus-robur', 'abies-alba', 'prunus-dulcis'] as const;

function time(fn: () => void, repeat: number): number {
  const start = performance.now();
  for (let i = 0; i < repeat; i++) fn();
  return (performance.now() - start) / repeat;
}

describe.skipIf(import.meta.env.MODE !== 'bench')('banco de rendimiento', () => {
  it('coste por especie a los 30 años', () => {
    const rows = SPECIES.map((id) => {
      const sim = new TreeSimulation({ speciesId: id, seed: 7 });
      const growStart = performance.now();
      sim.advanceYears(30);
      const growMs = performance.now() - growStart;
      const yearMs = time(() => {
        new TreeSimulation({ state: structuredClone(sim.state) }).advanceYears(1);
      }, 3);
      return {
        especie: id,
        entrenudos: Object.keys(sim.state.segments).length,
        '30 años (s)': +(growMs / 1000).toFixed(2),
        'ms/tick a los 30': +(yearMs / 52).toFixed(2),
        'instantánea (ms)': +time(() => buildRenderSnapshot(sim.state), 5).toFixed(1),
        'corteza (ms)': +time(() => buildBarkMesh(sim.state), 5).toFixed(1),
      };
    });
    console.table(rows);
    expect(rows).toHaveLength(SPECIES.length);
  }, 600000);
});
