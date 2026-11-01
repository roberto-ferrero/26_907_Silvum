import { describe, expect, it } from 'vitest';
import { DT_YEARS, seasonPhase, yearOf } from '../src/sim/clock.ts';
import { isMarcescent, leafTraits, senescenceProgress } from '../src/sim/leaves.ts';
import { listArchetypes } from '../src/sim/morphotype.ts';
import { DETACH_KIND, DETACH_STRIDE, attachedLeafCount } from '../src/sim/organs.ts';
import { DEFAULT_CALENDAR, calendarProblems, phenophase } from '../src/sim/phenology.ts';
import { buildRenderSnapshot, ORGAN_STRIDE } from '../src/sim/snapshot.ts';
import { SPECIES_PRESETS } from '../src/presets/species.ts';
import { getSpecies, listSpecies, speciesProblems } from '../src/sim/species.ts';
import { TreeSimulation } from '../src/sim/tree.ts';
import type { TreeState } from '../src/sim/types.ts';

/** Avanza hasta la fase `phase` del año `year`. */
function advanceTo(sim: TreeSimulation, year: number, phase: number): void {
  while (sim.state.timeYears < year + phase - 1e-9) sim.step();
}

function grown(speciesId: string, seed: number, years: number): TreeSimulation {
  const sim = new TreeSimulation({ speciesId, seed });
  sim.advanceYears(years);
  return sim;
}

/** Desprendimientos de un tipo, como lista de instantes (años). */
function detachTimes(records: Float32Array, kind: number): number[] {
  const out: number[] = [];
  for (let o = 0; o < records.length; o += DETACH_STRIDE) {
    if (records[o] === kind) out.push(records[o + 1]!);
  }
  return out;
}

describe('presets de especie', () => {
  it('los tres presets cumplen el esquema', () => {
    expect(listSpecies().map((s) => s.id)).toEqual([
      'abies-alba',
      'quercus-robur',
      'prunus-dulcis',
    ]);
    for (const preset of SPECIES_PRESETS) {
      expect(speciesProblems(preset), preset.id).toEqual([]);
      const species = getSpecies(preset.id);
      expect(species.status).toBe('illustrative-not-calibrated');
      expect(species.resolvedScale.status).toBe('artistic-not-calibrated');
      expect(species.resolvedScale.divergenceDeg).toBe(preset.phyllotaxis.divergenceDeg);
    }
  });

  it('declaran el carácter de cada especie', () => {
    const fir = getSpecies('abies-alba');
    const oak = getSpecies('quercus-robur');
    const almond = getSpecies('prunus-dulcis');
    expect([fir.leaves.habit, fir.leaves.form.shape, fir.archetypeId]).toEqual([
      'evergreen',
      'needle',
      'conical-conifer',
    ]);
    expect([oak.leaves.habit, oak.leaves.form.shape]).toEqual(['deciduous', 'lobed']);
    expect(oak.leaves.marcescence).toBeGreaterThan(0);
    expect(almond.leaves.form.shape).toBe('lanceolate');
    // El almendro florece antes de brotar.
    expect(almond.flowering!.bloom[1]).toBeLessThanOrEqual(almond.phenology.budRelease[0]);
    expect(almond.fruiting!.massKg).toBeGreaterThan(0);
    expect(fir.flowering).toBeNull();
  });

  it('cada arquetipo tiene una especie genérica válida', () => {
    for (const { id } of listArchetypes()) {
      const species = getSpecies(id);
      expect(speciesProblems(species)).toEqual([]);
      expect(species.phenology).toBe(DEFAULT_CALENDAR);
    }
  });

  it('detecta presets incorrectos', () => {
    const broken = {
      ...SPECIES_PRESETS[1]!,
      phyllotaxis: { mode: 'spiral' as const, divergenceDeg: Number.NaN },
      phenology: { ...DEFAULT_CALENDAR, senescence: [0.9, 0.8] as const },
    };
    expect(speciesProblems(broken).length).toBeGreaterThanOrEqual(2);
  });
});

describe('calendario fenológico', () => {
  it('el calendario por defecto es válido y nombra las fases', () => {
    expect(calendarProblems(DEFAULT_CALENDAR)).toEqual([]);
    const almond = getSpecies('prunus-dulcis');
    const input = { calendar: almond.phenology, deciduous: true, bloom: almond.flowering!.bloom };
    expect(phenophase(input, 0.02)).toBe('reposo');
    expect(phenophase(input, 0.12)).toBe('floración');
    expect(phenophase(input, 0.22)).toBe('brotación');
    expect(phenophase(input, 0.6)).toBe('crecimiento');
    expect(phenophase(input, 0.78)).toBe('senescencia');
  });
});

describe('hojas', () => {
  it('en caducas no quedan hojas vivas en invierno; sí en verano', () => {
    const almond = grown('prunus-dulcis', 3, 12);
    advanceTo(almond, 12, 0.6);
    expect(attachedLeafCount(almond.state)).toBeGreaterThan(30);
    advanceTo(almond, 13, 0.05);
    expect(attachedLeafCount(almond.state)).toBe(0);

    // Roble: solo quedan hojas marcescentes (secas) hasta la brotación.
    const oak = grown('quercus-robur', 3, 10);
    advanceTo(oak, 10, 0.6);
    const summer = attachedLeafCount(oak.state);
    expect(summer).toBeGreaterThan(30);
    advanceTo(oak, 11, 0.05);
    const s = oak.state;
    const species = getSpecies(s.speciesId);
    let retained = 0;
    for (const c of Object.values(s.leafCohorts)) {
      const traits = leafTraits(s.seed, c.id, c.count);
      for (let i = 0; i < c.count; i++) {
        if (!((c.attachedMask >>> i) & 1)) continue;
        retained++;
        expect(isMarcescent(species, traits, i)).toBe(true);
        expect(senescenceProgress(species, c, traits, i, s.timeYears)).toBeGreaterThanOrEqual(1);
      }
    }
    expect(retained).toBeLessThan(summer * 0.6);
    // Tras la brotación caen también las marcescentes.
    advanceTo(oak, 11, species.phenology.budRelease[0] + 0.1);
    for (const c of Object.values(s.leafCohorts)) {
      if (c.attachedMask !== 0) expect(yearOf(c.bornAtYears)).toBe(11);
    }
  });

  it('en perennes hay hojas todo el año, con cohortes de varias edades', () => {
    const fir = grown('abies-alba', 4, 14);
    advanceTo(fir, 14, 0.05);
    const s = fir.state;
    expect(attachedLeafCount(s)).toBeGreaterThan(100);
    const species = getSpecies('abies-alba');
    const ages = Object.values(s.leafCohorts)
      .filter((c) => c.attachedMask !== 0)
      .map((c) => s.timeYears - c.bornAtYears);
    expect(Math.max(...ages)).toBeGreaterThan(4);
    const maxLife = species.leaves.lifespanYears * (1 + species.leaves.lifespanJitter) + 2;
    expect(Math.max(...ages)).toBeLessThan(maxLife);
  });

  it('el cambio de color otoñal no es uniforme', () => {
    const oak = grown('quercus-robur', 5, 10);
    const species = getSpecies('quercus-robur');
    const sen = species.phenology.senescence;
    advanceTo(oak, 10, (sen[0] + sen[1]) / 2);
    const s = oak.state;
    const progress: number[] = [];
    const dates = new Set<number>();
    for (const c of Object.values(s.leafCohorts)) {
      if (yearOf(c.bornAtYears) !== 10) continue;
      dates.add(Math.round(c.senescenceAtYears * 1e4));
      const traits = leafTraits(s.seed, c.id, c.count);
      for (let i = 0; i < c.count; i++) {
        if ((c.attachedMask >>> i) & 1) {
          progress.push(Math.min(1, senescenceProgress(species, c, traits, i, s.timeYears)));
        }
      }
    }
    expect(dates.size).toBeGreaterThan(5);
    const mean = progress.reduce((a, b) => a + b, 0) / progress.length;
    const sd = Math.sqrt(progress.reduce((a, b) => a + (b - mean) ** 2, 0) / progress.length);
    expect(progress.length).toBeGreaterThan(20);
    expect(sd).toBeGreaterThan(0.08);
    expect(progress.some((p) => p < 0.3)).toBe(true);
    expect(progress.some((p) => p > 0.7)).toBe(true);
  });

  it('caen hojas de fondo en verano y la mayoría en otoño', () => {
    const oak = grown('quercus-robur', 6, 9);
    oak.drainDetachments();
    oak.advanceYears(1);
    const times = detachTimes(oak.drainDetachments(), DETACH_KIND.leaf);
    const sen = getSpecies('quercus-robur').phenology.senescence;
    const summer = times.filter((t) => seasonPhase(t) > 0.45 && seasonPhase(t) < sen[0]);
    const autumn = times.filter((t) => seasonPhase(t) >= sen[0]);
    expect(summer.length).toBeGreaterThan(0);
    expect(autumn.length).toBeGreaterThan(summer.length * 3);
  });

  it('el viento arranca más hojas sin cambiar la madera de una caduca', () => {
    const calm = grown('quercus-robur', 8, 9);
    const windy = new TreeSimulation({ state: structuredClone(calm.state) });
    windy.setWind({ intensity01: 1, directionRad: 0.5 });
    calm.drainDetachments();
    advanceTo(calm, 9, 0.7);
    advanceTo(windy, 9, 0.7);
    const nCalm = detachTimes(calm.drainDetachments(), DETACH_KIND.leaf).length;
    const nWindy = detachTimes(windy.drainDetachments(), DETACH_KIND.leaf).length;
    expect(nWindy).toBeGreaterThan(nCalm + 10);
    expect(windy.state.events.some((e) => e.kind === 'environment-changed')).toBe(true);
    // La historia de la madera no depende de las hojas arrancadas.
    advanceTo(calm, 11, 0.5);
    advanceTo(windy, 11, 0.5);
    expect(JSON.stringify(windy.state.segments)).toBe(JSON.stringify(calm.state.segments));
  });
});

describe('flores y frutos', () => {
  it('el almendro florece antes de sacar las hojas', () => {
    const sim = grown('prunus-dulcis', 2, 6);
    let firstFlower = Infinity;
    let firstLeaf = Infinity;
    const start = sim.state.timeYears;
    while (sim.state.timeYears < start + 1) {
      sim.step();
      const snap = buildRenderSnapshot(sim.state);
      const t = sim.state.timeYears;
      const openFlowers = Object.values(sim.state.flowerCohorts).some((c) => t >= c.openAtYears);
      if (openFlowers && snap.flowers.count > 0) firstFlower = Math.min(firstFlower, t);
      if (snap.leaves.count > 0) firstLeaf = Math.min(firstLeaf, t);
    }
    expect(firstFlower).toBeLessThan(firstLeaf);
    expect(firstLeaf - firstFlower).toBeGreaterThan(2 * DT_YEARS);
  });

  it('las flores sueltan pétalos, cuajan frutos que crecen y caen', () => {
    const sim = grown('prunus-dulcis', 2, 7);
    sim.drainDetachments();
    const program = getSpecies('prunus-dulcis').fruiting!;
    advanceTo(sim, 7, 0.3);
    const young = Object.values(sim.state.fruits);
    expect(young.length).toBeGreaterThan(0);
    advanceTo(sim, 7, 0.55);
    const grownFruits = Object.values(sim.state.fruits);
    expect(grownFruits.length).toBeGreaterThan(0);
    expect(grownFruits.length).toBeLessThan(young.length); // caída temprana
    for (const f of grownFruits) {
      expect(f.massKg).toBeGreaterThan(0);
      expect(f.massKg).toBeLessThanOrEqual(program.massKg + 1e-12);
    }
    const mid = buildRenderSnapshot(sim.state);
    expect(mid.fruitMassKg).toBeGreaterThan(0);
    advanceTo(sim, 8, 0);
    expect(Object.values(sim.state.fruits).every((f) => yearOf(f.setAtYears) === 8)).toBe(true);
    const records = sim.drainDetachments();
    expect(detachTimes(records, DETACH_KIND.petal).length).toBeGreaterThan(0);
    expect(detachTimes(records, DETACH_KIND.fruit).length).toBeGreaterThan(0);
  });

  it('el roble da bellotas que maduran en otoño', () => {
    const sim = grown('quercus-robur', 1, 20);
    sim.drainDetachments();
    // Se vacía cada semana: el búfer de desprendimientos es acotado y hay muchas hojas.
    const drops: number[] = [];
    for (let i = 0; i < 104; i++) {
      sim.step();
      drops.push(...detachTimes(sim.drainDetachments(), DETACH_KIND.fruit));
    }
    const ripe = drops.filter(
      (t) => seasonPhase(t) >= getSpecies('quercus-robur').fruiting!.drop[0],
    );
    expect(ripe.length).toBeGreaterThan(0);
  });
});

describe('determinismo y dibujo con órganos', () => {
  const firstOrgans = (s: TreeState): string =>
    JSON.stringify([s.leafCohorts, s.flowerCohorts, s.fruits]);

  it('misma semilla, mismos órganos; reanudar da lo mismo', () => {
    const a = grown('prunus-dulcis', 9, 7);
    const b = grown('prunus-dulcis', 9, 7);
    expect(firstOrgans(a.state)).toBe(firstOrgans(b.state));
    const snapshot = structuredClone(a.state);
    a.advanceYears(1.5);
    const resumed = new TreeSimulation({ state: snapshot });
    resumed.advanceYears(1.5);
    expect(JSON.stringify(resumed.state)).toBe(JSON.stringify(a.state));
  });

  it('la instantánea no altera el estado y sus órganos son finitos', () => {
    for (const id of ['abies-alba', 'quercus-robur', 'prunus-dulcis']) {
      const sim = grown(id, 3, 6);
      advanceTo(sim, 6, 0.55);
      const before = JSON.stringify(sim.state);
      const snap = buildRenderSnapshot(sim.state, sim.drainDetachments());
      expect(JSON.stringify(sim.state)).toBe(before);
      expect(snap.leaves.count).toBeGreaterThan(0);
      for (const buffers of [snap.leaves, snap.flowers, snap.fruits]) {
        expect(buffers.data.length).toBe(buffers.count * ORGAN_STRIDE);
        expect(buffers.data.every(Number.isFinite)).toBe(true);
      }
      expect(snap.detachments.every(Number.isFinite)).toBe(true);
    }
  });

  it('40 años de cada especie caben en pocos segundos', () => {
    const start = performance.now();
    for (const id of ['quercus-robur', 'prunus-dulcis']) grown(id, 7, 40);
    // ~7 s en solitario; holgura para la ejecución en paralelo con otros ficheros y la CI.
    expect(performance.now() - start).toBeLessThan(25000);
  }, 60000);
});
