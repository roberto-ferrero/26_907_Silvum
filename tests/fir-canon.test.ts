import { describe, expect, it } from 'vitest';
import { TreeSimulation } from '../src/sim/tree.ts';
import { crownMetrics } from './crown-metrics.ts';

/**
 * Canon del abeto (dirección de arte, decisión 14): cono esbelto con el líder como cima,
 * ramas hasta casi la base y copa más alta que ancha, más ancha abajo que arriba.
 */
describe('canon del abeto', () => {
  it('a 30 años: cono con líder dominante y ramas bajas', () => {
    for (const seed of [7, 11]) {
      const sim = new TreeSimulation({ speciesId: 'abies-alba', seed });
      sim.advanceYears(30.6);
      const s = sim.state;
      const m = crownMetrics(s);
      expect(m.leaderTop01).toBeGreaterThan(0.95);
      expect(m.widthToHeight).toBeGreaterThan(0.25);
      expect(m.widthToHeight).toBeLessThan(0.7);
      expect(m.crownBase01).toBeLessThan(0.15);
      // Más ancho en el tercio inferior que en el superior.
      const ends = Object.values(s.segments).map((g) => g.end);
      const h = m.heightM;
      const spread = (lo: number, hi: number): number =>
        Math.max(
          ...ends.filter((p) => p[1] >= lo * h && p[1] < hi * h).map((p) => Math.hypot(p[0], p[2])),
        );
      expect(spread(0.1, 0.4)).toBeGreaterThan(spread(0.7, 1.0) * 1.5);
    }
  }, 120000);
});
