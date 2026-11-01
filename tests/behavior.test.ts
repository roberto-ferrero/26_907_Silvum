import { describe, expect, it } from 'vitest';
import { DEFAULT_SHADOW } from '../src/sim/light.ts';
import type { LightField } from '../src/sim/light.ts';
import { buildLightField, TreeSimulation, type LightModifier } from '../src/sim/tree.ts';
import type { TreeState } from '../src/sim/types.ts';
import type { Vec3 } from '../src/sim/vec3.ts';

/**
 * Pruebas de comportamiento (fase 9.4) y de convergencia de la rejilla de luz (9.3).
 * Usan la especie genérica de copa amplia: sin envolvente artística que imponga la forma,
 * la respuesta a la luz y a la poda es la del motor.
 */
const ARCHETYPE = 'broad-crown-broadleaf';

const living = (s: TreeState) =>
  Object.values(s.segments).filter((g) => s.axes[g.axisId]?.woodState === 'living');

const meanX = (s: TreeState): number => {
  const segs = living(s);
  return segs.reduce((a, g) => a + g.end[0], 0) / segs.length;
};

/** Luz que llega más por +X: más exposición allí y dirección favorable hacia +X. */
const lightFromPlusX: LightModifier = (base: LightField) => ({
  exposure: (p: Vec3) => base.exposure(p) * Math.max(0.2, Math.min(1, 0.6 + p[0] * 6)),
  favorableDirection: () => [0.8, 0.6, 0],
});

/** Sombra prolongada sobre el lado −X. */
const shadeMinusX: LightModifier = (base: LightField) => ({
  exposure: (p: Vec3) => (p[0] < -0.005 ? base.exposure(p) * 0.05 : base.exposure(p)),
  favorableDirection: (p: Vec3) => base.favorableDirection(p),
});

describe('comportamiento', () => {
  it('con luz lateral la copa se desplaza hacia la luz', () => {
    const plain = new TreeSimulation({ archetypeId: ARCHETYPE, seed: 4 });
    const lit = new TreeSimulation({
      archetypeId: ARCHETYPE,
      seed: 4,
      lightModifier: lightFromPlusX,
    });
    plain.advanceYears(10);
    lit.advanceYears(10);
    expect(meanX(lit.state)).toBeGreaterThan(meanX(plain.state) + 0.02);
  });

  it('con sombra prolongada en un lado, ese lado pierde ramas', () => {
    const sim = new TreeSimulation({ archetypeId: ARCHETYPE, seed: 6, lightModifier: shadeMinusX });
    sim.advanceYears(12);
    const segs = living(sim.state);
    const shaded = segs.filter((g) => g.end[0] < -0.01).length;
    const lit = segs.filter((g) => g.end[0] > 0.01).length;
    expect(lit).toBeGreaterThan(shaded * 1.5);
  });

  it('al quitar el ápice, una lateral alta releva al líder', () => {
    const sim = new TreeSimulation({ archetypeId: ARCHETYPE, seed: 8 });
    sim.advanceYears(5.1);
    const s = sim.state;
    const trunk = Object.values(s.axes).find((a) => a.parentAxisId === null)!;
    s.buds[trunk.terminalBudId!]!.state = 'dead';
    const trunkTop = Math.max(...trunk.segmentIds.map((id) => s.segments[id]!.end[1]));
    sim.advanceYears(3);
    const higher = living(sim.state).filter(
      (g) => g.axisId !== trunk.id && g.end[1] > trunkTop + 0.03,
    );
    expect(higher.length).toBeGreaterThan(3);
  });
});

describe('convergencia de la rejilla de luz', () => {
  it('la exposición de las yemas apenas cambia al refinar la rejilla', () => {
    const sim = new TreeSimulation({ archetypeId: ARCHETYPE, seed: 2 });
    sim.advanceYears(12.3);
    const s = sim.state;
    const coarse = buildLightField(s);
    const fine = buildLightField(s, {
      cellSizeM: DEFAULT_SHADOW.cellSizeM / 2,
      depth: DEFAULT_SHADOW.depth * 2,
      // Misma atenuación por metro: la sombra por celda se reparte en el doble de celdas.
      b: Math.SQRT2,
    });
    const points = Object.values(s.buds)
      .filter((b) => b.state !== 'dead' && b.segmentId !== null)
      .map((b) => s.segments[b.segmentId!]!.end);
    const a = points.map((p) => coarse.exposure(p));
    const b = points.map((p) => fine.exposure(p));
    const mean = (x: number[]) => x.reduce((u, v) => u + v, 0) / x.length;
    const ma = mean(a);
    const mb = mean(b);
    let cov = 0;
    let va = 0;
    let vb = 0;
    for (let i = 0; i < a.length; i++) {
      cov += (a[i]! - ma) * (b[i]! - mb);
      va += (a[i]! - ma) ** 2;
      vb += (b[i]! - mb) ** 2;
    }
    const correlation = cov / Math.sqrt(va * vb);
    expect(points.length).toBeGreaterThan(50);
    expect(correlation).toBeGreaterThan(0.7);
  });
});
