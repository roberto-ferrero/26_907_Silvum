import { describe, expect, it } from 'vitest';
import { TreeSimulation } from '../src/sim/tree.ts';
import { Timeline, deserializeState, serializeState } from '../src/worker/timeline.ts';

describe('línea de tiempo', () => {
  it('serializar y restaurar conserva el estado (incluido Infinity) y la continuación', () => {
    const sim = new TreeSimulation({ speciesId: 'prunus-dulcis', seed: 3 });
    sim.advanceYears(6);
    const restored = deserializeState(serializeState(sim.state));
    expect(serializeState(restored)).toBe(serializeState(sim.state));
    expect(Object.values(restored.buds).some((b) => b.hazard.threshold === Infinity)).toBe(true);
    const resumed = new TreeSimulation({ state: restored });
    sim.advanceYears(1.5);
    resumed.advanceYears(1.5);
    expect(serializeState(resumed.state)).toBe(serializeState(sim.state));
  });

  it('guarda instantáneas en los años marcados y restaura la más cercana anterior', async () => {
    const timeline = new Timeline(0, () => {});
    const sim = new TreeSimulation({ speciesId: 'quercus-robur', seed: 2 });
    timeline.reset(sim.state);
    for (let i = 0; i < 52 * 7; i++) {
      sim.step();
      timeline.record(sim.state);
    }
    expect(timeline.nearest(5.5)).toBe(3);
    expect(timeline.nearest(6.2)).toBe(6);
    const state = await timeline.restore(6);
    expect(Math.round(state.timeYears)).toBe(6);
    expect(Object.keys(state.segments).length).toBeGreaterThan(0);
  });
});
