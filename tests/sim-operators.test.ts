import { describe, expect, it } from 'vitest';
import {
  accumulateCredit,
  advanceHazard,
  allocateBorchertHonda,
  allocateWeighted,
  thresholdFromUniform,
} from '../src/sim/allocation.ts';
import { activationBias, evaluateRoleProgram, getArchetype } from '../src/sim/morphotype.ts';
import {
  branchBirthDirection,
  inclinationFromUp,
  inclinationTargetDirection,
  steerDirection,
} from '../src/sim/orientation.ts';
import { eventUniform, smoothNoise1D } from '../src/sim/random.ts';
import { angleBetween, dot, length, transportNormal, type Vec3 } from '../src/sim/vec3.ts';
import { growRadius, pipeTargetRadius } from '../src/sim/wood.ts';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('reparto de recursos', () => {
  it('Borchert-Honda conserva el presupuesto y respeta la preferencia apical', () => {
    const r = allocateBorchertHonda(10, 4, 6, 0.52);
    expect(r.main + r.lateral + r.unused).toBeCloseTo(10, 12);
    const neutral = allocateBorchertHonda(10, 5, 5, 0.5);
    expect(neutral.main).toBeCloseTo(5, 12);
    expect(allocateBorchertHonda(10, 5, 5, 0.6).main).toBeGreaterThan(5);
  });

  it('sin señal no inventa crecimiento', () => {
    expect(allocateBorchertHonda(10, 0, 0, 0.5)).toEqual({ main: 0, lateral: 0, unused: 10 });
    expect(allocateWeighted(3, [{ signal: 0, weight: 1 }]).unused).toBe(3);
  });

  it('el reparto ponderado conserva el presupuesto exactamente y nunca es negativo', () => {
    const sinks = [0.1, 0.3, 0.7, 1e-9, 0].map((signal) => ({ signal, weight: 1 }));
    const r = allocateWeighted(7.3, sinks);
    expect(r.allocations.reduce((a, b) => a + b, 0) + r.unused).toBeCloseTo(7.3, 12);
    expect(r.allocations.every((a) => a >= 0)).toBe(true);
    expect(r.allocations[4]).toBe(0);
  });

  it('el crédito fraccionario conserva el resto', () => {
    expect(accumulateCredit(0.4, 2.8, 1)).toEqual({ units: 3, carry: expect.closeTo(0.2, 9) });
  });
});

describe('activación por hazard', () => {
  it('el instante de activación no depende de partir el paso con tasa constante', () => {
    const threshold = thresholdFromUniform(0.63);
    const coarse = advanceHazard({ accumulated: 0, threshold, activated: false }, 2, 1);
    let fine = { accumulated: 0, threshold, activated: false };
    let crossedAt = -1;
    for (let i = 0; i < 100; i++) {
      const step = advanceHazard(fine, 2, 0.01);
      fine = step.state;
      if (step.crossedAtFraction !== null) {
        crossedAt = (i + step.crossedAtFraction) * 0.01;
        break;
      }
    }
    expect(coarse.crossedAtFraction).not.toBeNull();
    expect(crossedAt).toBeCloseTo(coarse.crossedAtFraction!, 9);
  });

  it('un episodio activado permanece activado', () => {
    const s = advanceHazard({ accumulated: 0, threshold: 0.1, activated: false }, 10, 1).state;
    expect(advanceHazard(s, 10, 1).crossedAtFraction).toBeNull();
  });
});

describe('orientación', () => {
  it('el nacimiento se mide respecto al eje portador, no a la vertical', () => {
    const horizontal: Vec3 = [1, 0, 0];
    const d = branchBirthDirection(horizontal, [0, 1, 0], 0, deg(45));
    expect(angleBetween(d, horizontal)).toBeCloseTo(deg(45), 9);
  });

  it('la inclinación objetivo se mide respecto a la vertical del mundo', () => {
    const t = inclinationTargetDirection([0.2, 0.9, 0.1], [0, 1, 0], [1, 0, 0], deg(70));
    expect(inclinationFromUp(t)).toBeCloseTo(deg(70), 9);
  });

  it('el giro por entrenudo está limitado por longitud', () => {
    const out = steerDirection({
      tangent: [0, 1, 0],
      lightDirection: null,
      targetDirection: [1, 0, 0],
      noise: [0, 0, 0],
      weights: { heading: 0, light: 0, target: 1 },
      segmentLengthM: 0.01,
      maxTurnRadPerM: 10,
    });
    expect(angleBetween(out, [0, 1, 0])).toBeCloseTo(0.1, 9);
  });

  it('el transporte paralelo mantiene el marco unitario y perpendicular', () => {
    const n = transportNormal([1, 0, 0], [0, 1, 0], [0.6, 0.8, 0]);
    expect(length(n)).toBeCloseTo(1, 9);
    expect(dot(n, [0.6, 0.8, 0])).toBeCloseTo(0, 9);
  });
});

describe('madera', () => {
  it('pipe con p=2 conserva el área', () => {
    expect(pipeTargetRadius([3, 4], 2)).toBeCloseTo(5, 12);
  });

  it('el radio nunca decrece y respeta el tope temporal', () => {
    expect(growRadius(0.02, 0.01, 0.004, 1, 1)).toBe(0.02);
    expect(growRadius(0.02, 0.05, 0.004, 0.25, 1)).toBeCloseTo(0.021, 12);
  });
});

describe('aleatoriedad por evento', () => {
  it('no depende del orden de evaluación', () => {
    const a = [1, 2, 3].map((id) => eventUniform(7, id, 0));
    const b = [3, 2, 1].map((id) => eventUniform(7, id, 0)).reverse();
    expect(a).toEqual(b);
    expect(a.every((u) => u > 0 && u < 1)).toBe(true);
  });

  it('el ruido suave es continuo', () => {
    const d = Math.abs(smoothNoise1D(1, 2, 3.5) - smoothNoise1D(1, 2, 3.5001));
    expect(d).toBeLessThan(1e-3);
  });
});

describe('programas morfológicos', () => {
  it('interpola entre fases sin salirse de los keyframes', () => {
    const roles = getArchetype('broad-crown-broadleaf').morphotype.roles;
    const f = evaluateRoleProgram(roles.scaffold, 0.25);
    expect(f.angleAtBirthDeg).toBeCloseTo(45, 9);
  });

  it('el sesgo de activación interpola sus nudos', () => {
    expect(
      activationBias(
        [
          [0, 0],
          [1, 1],
        ],
        0.25,
      ),
    ).toBeCloseTo(0.25, 12);
  });
});
