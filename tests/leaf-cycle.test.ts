import { describe, expect, it } from 'vitest';
import { buildCycleFlowers, buildCycleLeaves } from '../src/sim/leaf-cycle.ts';
import { DETACH_KIND, DETACH_STRIDE } from '../src/sim/organs.ts';
import { TreeSimulation } from '../src/sim/tree.ts';

describe('ciclo de hojas independiente', () => {
  // Árbol en pleno invierno biológico: el follaje sigue al reloj visual, no al biológico.
  const almond = new TreeSimulation({ speciesId: 'prunus-dulcis', seed: 4 });
  almond.advanceYears(12.05);

  it('muestra verano o invierno según la fase visual, sin tocar el estado', () => {
    const before = JSON.stringify(almond.state);
    const summer = buildCycleLeaves(almond.state, 0.6, 0.59, 0)!;
    const winter = buildCycleLeaves(almond.state, 0.02, 0.01, 0)!;
    expect(JSON.stringify(almond.state)).toBe(before);
    expect(summer.leaves.count).toBeGreaterThan(30);
    expect(winter.leaves.count).toBe(0);
    expect(summer.leaves.data.every(Number.isFinite)).toBe(true);
  });

  it('el otoño visual suelta hojas como partículas', () => {
    let dropped = 0;
    let phase = 0.7;
    while (phase < 0.98) {
      const next = phase + 0.01;
      const r = buildCycleLeaves(almond.state, next, phase, 3)!;
      for (let o = 0; o < r.detachments.length; o += DETACH_STRIDE) {
        expect(r.detachments[o]).toBe(DETACH_KIND.leaf);
        expect(r.detachments[o + 1]).toBe(3);
        dropped++;
      }
      phase = next;
    }
    const summer = buildCycleLeaves(almond.state, 0.6, 0.59, 0)!;
    expect(dropped).toBeGreaterThan(summer.leaves.count * 0.8);
  });

  it('las flores del almendro siguen el ciclo visual: antes que las hojas', () => {
    const bloom = buildCycleFlowers(almond.state, 0.13, 0.12, 0);
    const summer = buildCycleFlowers(almond.state, 0.5, 0.49, 0);
    expect(bloom.flowers.count).toBeGreaterThan(0);
    expect(summer.flowers.count).toBe(0);
    expect(buildCycleLeaves(almond.state, 0.13, 0.12, 0)!.leaves.count).toBe(0);
    let petals = 0;
    for (let p = 0.1; p < 0.3; p += 0.01) {
      petals += buildCycleFlowers(almond.state, p + 0.01, p, 0).detachments.length;
    }
    expect(petals).toBeGreaterThan(0);
  });

  it('las perennes siguen el estado biológico', () => {
    const fir = new TreeSimulation({ speciesId: 'abies-alba', seed: 4 });
    fir.advanceYears(5);
    expect(buildCycleLeaves(fir.state, 0.5, 0.4, 0)).toBeNull();
  });
});
