import { describe, expect, it } from 'vitest';
import { FallingOrgans, rotate, type Ground } from '../src/fx/falling.ts';
import { createLeafGeometry, leafHalfWidth } from '../src/render/organ-geometry.ts';
import { DEFAULT_POT, groundHeightLocal, soilTopY } from '../src/render/pot.ts';
import { DETACH_KIND, DETACH_STRIDE } from '../src/sim/organs.ts';
import { getSpecies } from '../src/sim/species.ts';
import { CALM, type WindSettings } from '../src/sim/wind.ts';

function record(kind: number, at: number, p: [number, number, number]): Float32Array {
  const r = new Float32Array(DETACH_STRIDE);
  r.set([kind, at, ...p, 0, 0, 0, 1, 0.03, 0.4, 0.3, 0.1]);
  return r;
}

const flat: Ground = () => 0;

/** Simula hasta que todas las partículas se posan; devuelve el tiempo (s). */
function settle(sys: FallingOrgans, wind: WindSettings, ground: Ground = flat): number {
  let t = 0;
  while (sys.particles.some((p) => !p.landed) && t < 60) {
    sys.step(1 / 60, t, 1, wind, 3, ground);
    t += 1 / 60;
  }
  return t;
}

describe('órganos que caen', () => {
  it('una hoja cae despacio y un fruto casi en caída libre', () => {
    const leaf = new FallingOrgans();
    leaf.spawn(record(DETACH_KIND.leaf, 1, [0, 0.6, 0]), flat, 1);
    const tLeaf = settle(leaf, CALM);
    const fruit = new FallingOrgans();
    fruit.spawn(record(DETACH_KIND.fruit, 1, [0, 0.6, 0]), flat, 1);
    const tFruit = settle(fruit, CALM);
    expect(tLeaf).toBeGreaterThan(0.3); // ~0,6 m a ~1 m/s con balanceo
    expect(tLeaf).toBeLessThan(2);
    expect(tFruit).toBeLessThan(0.8); // √(2·0,6/g) ≈ 0,35 s más un rebote
    expect(tLeaf).toBeGreaterThan(tFruit);
  });

  it('el viento desplaza la hoja a sotavento, no al fruto', () => {
    const wind: WindSettings = { intensity01: 1, directionRad: 0 };
    const leaf = new FallingOrgans();
    leaf.spawn(record(DETACH_KIND.leaf, 1, [0, 0.8, 0]), flat, 1);
    settle(leaf, wind);
    const fruit = new FallingOrgans();
    fruit.spawn(record(DETACH_KIND.fruit, 1, [0, 0.8, 0]), flat, 1);
    settle(fruit, wind);
    const leafDrift = leaf.particles[0]!.position[0];
    expect(leafDrift).toBeGreaterThan(0.3);
    expect(Math.abs(fruit.particles[0]!.position[0])).toBeLessThan(leafDrift / 3);
  });

  it('se posa plana en el sustrato o en la mesa', () => {
    const ground = groundHeightLocal(DEFAULT_POT);
    const sys = new FallingOrgans();
    sys.spawn(record(DETACH_KIND.leaf, 1, [0, 0.3, 0]), ground, 1);
    sys.spawn(record(DETACH_KIND.leaf, 1, [0.8, 0.3, 0]), ground, 1);
    settle(sys, CALM, ground);
    const [inPot, outside] = sys.particles;
    expect(inPot!.position[1]).toBeCloseTo(0, 2);
    expect(outside!.position[1]).toBeCloseTo(-soilTopY(DEFAULT_POT), 2);
    for (const p of sys.particles) expect(rotate(p.q, [0, 0, 1])[1]).toBeGreaterThan(0.99);
  });

  it('en el suelo se desvanece con el tiempo simulado', () => {
    const sys = new FallingOrgans();
    sys.spawn(record(DETACH_KIND.leaf, 1, [0, 0.2, 0]), flat, 1);
    settle(sys, CALM);
    const sizes: number[] = [];
    for (const years of [1.01, 1.2, 1.34]) {
      sys.forEach(DETACH_KIND.leaf, years, (_p, _q, scale) => sizes.push(scale));
    }
    expect(sizes[1]!).toBeLessThan(sizes[0]!);
    expect(sizes[2]!).toBeLessThan(sizes[1]!);
    sys.step(1 / 60, 0, 1.5, CALM, 3, flat);
    expect(sys.particles).toHaveLength(0);
  });

  it('tras un salto de años lo antiguo no se anima y respeta los topes', () => {
    const sys = new FallingOrgans({ maxFalling: 5, maxResting: 8 });
    const batch = new Float32Array(DETACH_STRIDE * 20);
    for (let i = 0; i < 20; i++)
      batch.set(record(DETACH_KIND.leaf, 1 + i * 0.001, [0, 0.5, 0]), i * DETACH_STRIDE);
    batch.set(record(DETACH_KIND.leaf, 0.2, [0, 0.5, 0]), 0); // ya descompuesta
    batch.set(record(DETACH_KIND.leaf, 0.9, [0, 0.5, 0]), DETACH_STRIDE); // antigua: al suelo
    sys.spawn(batch, flat, 1.02);
    expect(sys.particles.length).toBeLessThanOrEqual(5 + 8);
    expect(sys.fallingCount).toBeLessThanOrEqual(5);
    expect(sys.particles.every((p) => p.position.every(Number.isFinite))).toBe(true);
  });
});

describe('geometría de hojas', () => {
  it('la hoja lobulada tiene senos y la aguja es estrecha', () => {
    const oak = getSpecies('quercus-robur').leaves.form;
    const widths = Array.from({ length: 200 }, (_, i) => leafHalfWidth(oak, i / 199));
    let turns = 0;
    for (let i = 2; i < widths.length; i++) {
      const a = widths[i - 1]! - widths[i - 2]!;
      const b = widths[i]! - widths[i - 1]!;
      if (a > 0 && b < 0) turns++;
    }
    expect(turns).toBeGreaterThanOrEqual(3); // lóbulos
    const needle = getSpecies('abies-alba').leaves.form;
    expect(
      Math.max(...Array.from({ length: 50 }, (_, i) => leafHalfWidth(needle, i / 49))),
    ).toBeLessThan(0.1);
  });

  it('las geometrías de las tres especies son finitas', () => {
    for (const id of ['abies-alba', 'quercus-robur', 'prunus-dulcis']) {
      const g = createLeafGeometry(getSpecies(id).leaves.form);
      const pos = g.getAttribute('position').array as Float32Array;
      expect(pos.length).toBeGreaterThan(30);
      expect(pos.every(Number.isFinite)).toBe(true);
      expect(g.getAttribute('color')).toBeDefined();
    }
  });
});
