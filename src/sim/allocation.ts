/**
 * Reparto de recursos de crecimiento y activación por hazard.
 *
 * Presupuestos y créditos usan UNIDADES ABSTRACTAS de crecimiento (no carbono).
 * Borchert-Honda según Pałubicki et al. 2009, §4.2. El reparto ponderado, el hazard y el
 * crédito fraccionario son piezas de ingeniería (especificación §4-§5).
 */

function nonnegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} debe ser finito y no negativo`);
  }
}

export interface BinaryAllocation {
  main: number;
  lateral: number;
  /** Presupuesto sin asignar porque ambas señales eran nulas. */
  unused: number;
}

/**
 * main = V·λ·Qm / (λ·Qm + (1-λ)·Ql); lateral = V·(1-λ)·Ql / (...).
 * λ es una preferencia, no una fracción fija. Con señal total nula no inventa crecimiento.
 */
export function allocateBorchertHonda(
  budget: number,
  mainSignal: number,
  lateralSignal: number,
  lambda: number,
): BinaryAllocation {
  nonnegativeFinite(budget, 'budget');
  nonnegativeFinite(mainSignal, 'mainSignal');
  nonnegativeFinite(lateralSignal, 'lateralSignal');
  if (!(lambda >= 0 && lambda <= 1)) throw new RangeError('lambda debe estar en [0, 1]');
  const wm = lambda * mainSignal;
  const wl = (1 - lambda) * lateralSignal;
  const total = wm + wl;
  if (!(total > 0)) return { main: 0, lateral: 0, unused: budget };
  const main = (budget * wm) / total;
  return { main, lateral: Math.max(0, budget - main), unused: 0 };
}

/**
 * Reparto ponderado entre varios sumideros: a_i = V·w_i·Q_i / Σ(w·Q).
 * Conserva el presupuesto: Σa_i + unused = V (el último recibe el resto exacto).
 */
export function allocateWeighted(
  budget: number,
  sinks: readonly { signal: number; weight: number }[],
): { allocations: number[]; unused: number } {
  nonnegativeFinite(budget, 'budget');
  const scores = sinks.map((s, i) => {
    nonnegativeFinite(s.signal, `sinks[${i}].signal`);
    nonnegativeFinite(s.weight, `sinks[${i}].weight`);
    return s.signal * s.weight;
  });
  const total = scores.reduce((a, b) => a + b, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    return { allocations: scores.map(() => 0), unused: budget };
  }
  let assigned = 0;
  let lastPositive = -1;
  const allocations = scores.map((s, i) => {
    if (s > 0) lastPositive = i;
    const a = (budget * s) / total;
    assigned += a;
    return a;
  });
  if (lastPositive >= 0) {
    allocations[lastPositive] = Math.max(0, (allocations[lastPositive] ?? 0) + (budget - assigned));
  }
  return { allocations, unused: 0 };
}

/** Umbral exponencial T = -ln(1-U), sorteado una vez por yema y episodio. */
export function thresholdFromUniform(uniform: number): number {
  if (!(uniform > 0 && uniform < 1)) throw new RangeError('uniform debe estar en (0, 1)');
  return -Math.log1p(-uniform);
}

export interface HazardState {
  accumulated: number;
  threshold: number;
  activated: boolean;
}

export interface HazardStep {
  state: HazardState;
  /** Fracción del paso en que se cruzó el umbral (tasa constante en el paso), o null. */
  crossedAtFraction: number | null;
}

/** Integra H += h·dt contra un umbral persistente. Un episodio activado permanece activado. */
export function advanceHazard(
  state: HazardState,
  ratePerYear: number,
  dtYears: number,
): HazardStep {
  nonnegativeFinite(ratePerYear, 'ratePerYear');
  nonnegativeFinite(dtYears, 'dtYears');
  if (state.activated) return { state, crossedAtFraction: null };
  const increment = ratePerYear * dtYears;
  const accumulated = state.accumulated + increment;
  if (accumulated >= state.threshold) {
    const fraction = increment > 0 ? (state.threshold - state.accumulated) / increment : 0;
    return {
      state: { accumulated, threshold: state.threshold, activated: true },
      crossedAtFraction: Math.max(0, Math.min(1, fraction)),
    };
  }
  return { state: { ...state, accumulated }, crossedAtFraction: null };
}

/**
 * Crédito fraccionario: emite unidades enteras cuando el crédito alcanza su coste y
 * conserva el resto, en lugar de descartar floor(v).
 */
export function accumulateCredit(
  carry: number,
  earned: number,
  costPerUnit: number,
): { units: number; carry: number } {
  nonnegativeFinite(carry, 'carry');
  nonnegativeFinite(earned, 'earned');
  if (!(costPerUnit > 0) || !Number.isFinite(costPerUnit)) {
    throw new RangeError('costPerUnit debe ser positivo');
  }
  const total = carry + earned;
  const units = Math.floor(total / costPerUnit + 1e-9);
  return { units, carry: Math.max(0, total - units * costPerUnit) };
}
