import { describe, expect, it } from 'vitest';
import { TreeSimulation } from '../src/sim/tree.ts';
import { crownMetrics } from './crown-metrics.ts';

/**
 * Canon del roble común aislado (Quercus robur), a escala de maceta. Desde el 1 nov 2026
 * la prioridad es que se reconozca como un roble icónico (envolvente artística):
 * - joven: líder único y copa ovoide;
 * - pierde la dominancia apical y se bifurca en varias ramas madre (modelo de Rauh con
 *   hábito de bifurcación de los robles abiertos);
 * - adulto: fuste corto y limpio, copa ancha (anchura ≈ altura o más), sin flecha.
 * Rangos amplios: comprueban el carácter, no una calibración.
 */
describe('canon del roble', () => {
  const seeds = [7, 11];
  const sims = seeds.map((seed) => new TreeSimulation({ speciesId: 'quercus-robur', seed }));

  it('joven (4 años): líder dominante y copa estrecha', () => {
    for (const sim of sims) {
      sim.advanceYears(4.6);
      const m = crownMetrics(sim.state);
      expect(m.leaderTop01).toBeGreaterThan(0.95);
      expect(m.widthToHeight).toBeLessThan(0.8);
    }
  });

  it('adulto (40 años): fuste limpio, varias ramas madre, copa ancha y sin flecha', () => {
    for (const sim of sims) {
      sim.advanceYears(36);
      const s = sim.state;
      const m = crownMetrics(s);
      // El ápice del tronco original ha muerto (el registro de eventos es acotado).
      const trunk = Object.values(s.axes).find((a) => a.parentAxisId === null)!;
      const apex = trunk.terminalBudId !== null ? s.buds[trunk.terminalBudId] : undefined;
      expect(apex?.state ?? 'dead').toBe('dead');
      expect(m.leaderTop01).toBeLessThan(0.7);
      expect(m.widthToHeight).toBeGreaterThan(0.65);
      expect(m.crownBase01).toBeGreaterThan(0.15);
      expect(m.crownBase01).toBeLessThan(0.45);
      expect(m.scaffolds).toBeGreaterThanOrEqual(3);
    }
  }, 30000);
});
