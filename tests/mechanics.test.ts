import { describe, expect, it } from 'vitest';
import { MECH, axisMechanics, staticBend } from '../src/sim/mechanics.ts';
import { getSpecies } from '../src/sim/species.ts';
import { TreeSimulation } from '../src/sim/tree.ts';

describe('mecánica de ramas', () => {
  const sim = new TreeSimulation({ speciesId: 'quercus-robur', seed: 3 });
  sim.advanceYears(18.5);
  const mech = axisMechanics(sim.state, getSpecies('quercus-robur'));

  it('acumula masa por subárbol y la rigidez crece con el radio', () => {
    const trunk = [...mech.values()].find((a) => a.parentAxisId === null)!;
    for (const a of mech.values()) {
      expect(a.massKg).toBeGreaterThan(0);
      expect(a.massKg).toBeLessThanOrEqual(trunk.massKg + 1e-12);
      expect(a.inertia).toBeGreaterThan(0);
      expect(Number.isFinite(a.stiffness)).toBe(true);
      // Frecuencia propia acotada por la elección artística.
      expect(Math.sqrt(a.stiffness / a.inertia) / (2 * Math.PI)).toBeLessThanOrEqual(
        MECH.maxNaturalHz + 1e-9,
      );
    }
    const sorted = [...mech.values()].sort((a, b) => a.baseRadiusM - b.baseRadiusM);
    const thin = sorted[0]!;
    const thick = sorted[sorted.length - 1]!;
    expect(thick.stiffness / thick.lengthM ** -1).toBeGreaterThan(
      thin.stiffness / thin.lengthM ** -1,
    );
  });

  it('el peso comba las ramas hacia abajo y en ángulo acotado', () => {
    for (const a of mech.values()) {
      const theta = staticBend(a);
      expect(Math.hypot(...theta)).toBeLessThanOrEqual(MECH.maxStaticBendRad + 1e-9);
      // La rotación baja el centro de masas: (θ × (com − pivote)).y ≤ 0.
      const r = [a.com[0] - a.pivot[0], a.com[1] - a.pivot[1], a.com[2] - a.pivot[2]];
      const dy = theta[2] * r[0]! - theta[0] * r[2]!;
      expect(dy).toBeLessThanOrEqual(1e-12);
    }
  });

  it('la memoria lenta de forma baja las ramas con los años, sin pasar del límite', () => {
    const s = sim.state;
    const axes = Object.values(s.axes).filter((a) => a.woodState === 'living');
    expect(axes.some((a) => (a.sagMemoryRad ?? 0) > 0)).toBe(true);
    for (const a of axes) expect(a.sagMemoryRad ?? 0).toBeLessThanOrEqual(0.2 + 1e-9);
  });
});
