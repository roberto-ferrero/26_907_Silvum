/**
 * Ciclo estacional de las hojas DESACOPLADO del crecimiento (decisión del 1 nov 2026).
 *
 * El crecimiento sigue su reloj biológico; el aspecto del follaje de las caducas
 * (brotación, expansión, cambio de color, caída y árbol desnudo en invierno) sigue un reloj
 * estacional visual con su propia velocidad, editable por el usuario. Así puede verse un
 * otoño completo a ritmo pausado aunque el árbol crezca deprisa, o con el crecimiento
 * en pausa.
 *
 * Las hojas siguen siendo las cohortes del núcleo (posición y rasgos por hoja); solo se
 * evalúan en un instante de presentación `año de la temporada + fase visual` en lugar de
 * en el tiempo biológico. Las perennes no cambian: renuevan acículas a lo largo de años.
 * Es una capa de dibujo: no altera el estado.
 */
import { seasonPhase, yearOf } from './clock.ts';
import {
  LEAF_TRAIT,
  hexToLinear,
  isMarcescent,
  leafColor,
  leafPose,
  leafScale,
  leafTraits,
  senescenceProgress,
  trait,
} from './leaves.ts';
import { DETACH_KIND, DETACH_STRIDE } from './organs.ts';
import { ORGAN_STRIDE, type OrganBuffers } from './snapshot.ts';
import { getSpecies, type Species } from './species.ts';
import type { LeafCohort, TreeState } from './types.ts';

export type LeafCycleMode = 'coupled' | 'free';

/** Estado del reloj visual (vive en el Worker, fuera del estado biológico). */
export interface LeafCycleClock {
  /** Fase del año visual [0, 1). */
  phase: number;
  /** Años visuales acumulados (para descomponer las hojas caídas). */
  years: number;
}

type Visual = { visible: false } | { visible: true; dead: boolean };

/** Cohortes que visten el árbol: las de la última temporada (y la anterior al inicio). */
function seasonCohorts(s: TreeState, species: Species): { cohort: LeafCohort; year: number }[] {
  const out: { cohort: LeafCohort; year: number }[] = [];
  let latest = -Infinity;
  for (const c of Object.values(s.leafCohorts)) {
    if (!c.withered) latest = Math.max(latest, yearOf(c.bornAtYears));
  }
  if (!Number.isFinite(latest)) return out;
  // Mientras el brote del año aún se está formando, la temporada anterior completa la copa.
  const forming = seasonPhase(s.timeYears) < species.phenology.elongation[1];
  for (const c of Object.values(s.leafCohorts)) {
    if (c.withered || !s.segments[c.segmentId]) continue;
    const year = yearOf(c.bornAtYears);
    if (year === latest || (forming && year === latest - 1)) out.push({ cohort: c, year });
  }
  return out;
}

/** Estado visual de la hoja i en la fase visual `phase` de su temporada. */
function visualState(
  species: Species,
  cohort: LeafCohort,
  traits: Float32Array,
  i: number,
  year: number,
  phase: number,
): Visual {
  const t = year + phase;
  const bornPhase = cohort.bornAtYears - year;
  const marcescent = isMarcescent(species, traits, i);
  if (phase < bornPhase) {
    // Antes de brotar: solo quedan las marcescentes del otoño anterior, secas.
    const dropPhase =
      species.phenology.budRelease[0] + 0.08 * trait(traits, i, LEAF_TRAIT.senescenceOffset);
    return marcescent && phase < dropPhase ? { visible: true, dead: true } : { visible: false };
  }
  const p = senescenceProgress(species, cohort, traits, i, t);
  if (p >= 1 + trait(traits, i, LEAF_TRAIT.lag)) {
    return marcescent ? { visible: true, dead: true } : { visible: false };
  }
  return { visible: true, dead: false };
}

const pose = new Float32Array(7);

/**
 * Hojas de una caduca en la fase visual `phase` y caídas al pasar de `prevPhase` a `phase`
 * (registros `DETACH_STRIDE`, con el instante en años visuales `clockYears`).
 * Devuelve null si la especie es perenne (se usa el estado biológico).
 */
export function buildCycleLeaves(
  s: TreeState,
  phase: number,
  prevPhase: number,
  clockYears: number,
): { leaves: OrganBuffers; detachments: Float32Array } | null {
  const species = getSpecies(s.speciesId);
  if (species.leaves.habit !== 'deciduous') return null;
  const cohorts = seasonCohorts(s, species);
  let total = 0;
  for (const { cohort } of cohorts) total += cohort.count;
  const data = new Float32Array(total * ORGAN_STRIDE);
  const drops: number[] = [];
  const deadRgb = hexToLinear(species.leaves.colors.dead);
  const wrapped = phase < prevPhase;
  let n = 0;
  for (const { cohort, year } of cohorts) {
    const seg = s.segments[cohort.segmentId]!;
    const traits = leafTraits(s.seed, cohort.id, cohort.count);
    for (let i = 0; i < cohort.count; i++) {
      const now = visualState(species, cohort, traits, i, year, phase);
      if (!wrapped) {
        const before = visualState(species, cohort, traits, i, year, prevPhase);
        if (before.visible && !now.visible) {
          leafPose(species, seg, cohort, traits, i, pose, 0);
          const t = year + prevPhase;
          const rgb = before.dead ? deadRgb : leafColor(species, cohort, traits, i, t);
          drops.push(
            DETACH_KIND.leaf,
            clockYears,
            ...pose,
            leafScale(species, cohort, traits, i, t),
            rgb[0],
            rgb[1],
            rgb[2],
          );
        }
      }
      if (!now.visible) continue;
      leafPose(species, seg, cohort, traits, i, pose, 0);
      const t = year + phase;
      const o = n * ORGAN_STRIDE;
      data.set(pose, o);
      // Una marcescente en invierno conserva su tamaño final.
      data[o + 7] = now.dead
        ? leafScale(species, cohort, traits, i, year + 0.99)
        : leafScale(species, cohort, traits, i, t);
      const rgb = now.dead ? deadRgb : leafColor(species, cohort, traits, i, t);
      data[o + 8] = rgb[0];
      data[o + 9] = rgb[1];
      data[o + 10] = rgb[2];
      n++;
    }
  }
  const detachments = new Float32Array(drops);
  if (detachments.length % DETACH_STRIDE !== 0) throw new Error('registro de caída incompleto');
  return { leaves: { count: n, data: data.subarray(0, n * ORGAN_STRIDE) }, detachments };
}
