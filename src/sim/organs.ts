/**
 * Ciclo de vida de hojas, flores y frutos (fases 4.6-4.8), dentro del tick biológico.
 *
 * - Hojas: nacen con cada entrenudo, se expanden, envejecen con su fecha propia de
 *   senescencia y caen por tres vías: de fondo (hazard bajo todo el año), por ráfagas
 *   (según intensidad y estado de la hoja) y estacional (abscisión tras la senescencia).
 * - Flores: inducción en los brotes elegibles, apertura escalonada, caída de pétalos y
 *   cuajado. Frutos: crecimiento, masa, caída temprana o en madurez.
 *
 * Cada órgano que se separa se emite como desprendimiento visual (pose, tamaño y color en
 * el instante de la caída) para el sistema de partículas: no vuelve al estado biológico.
 * Todas las decisiones aleatorias usan muestras por identidad de evento.
 */
import { DT_YEARS, yearOf } from './clock.ts';
import { envelopeAt, envelopeDistance, envelopeSignalFactor } from './envelope.ts';
import {
  cohortSenescenceAt,
  healthFromExposure,
  hexToLinear,
  isMarcescent,
  leafColor,
  leafPose,
  leafScale,
  leafTraits,
  marcescentDropAt,
  senescenceProgress,
  LEAF_TRAIT,
  trait,
} from './leaves.ts';
import type { LightField } from './light.ts';
import { eventUniform } from './random.ts';
import {
  cohortOpenAt,
  flowerPose,
  flowerShedAt,
  fruitColor,
  fruitDropPlan,
  fruitGrowth,
  fruitMass,
  fruitPose,
} from './reproduction.ts';
import type { Species } from './species.ts';
import type { Axis, FlowerCohort, FruitState, LeafCohort, Segment, TreeState } from './types.ts';
import type { Vec3 } from './vec3.ts';
import { weeklyGust01 } from './wind.ts';

/** Tipos de desprendimiento visual. */
export const DETACH_KIND = Object.freeze({ leaf: 0, petal: 1, fruit: 2 });

/**
 * Registro de desprendimiento (floats): 0 tipo · 1 instante (años) · 2-4 posición ·
 * 5-8 cuaternión · 9 escala · 10-12 color lineal.
 */
export const DETACH_STRIDE = 13;

export interface OrganContext {
  state: TreeState;
  species: Species;
  light(): LightField;
  emit(record: Float32Array): void;
  /** Próximo instante en que alguna cohorte tiene algo que hacer (caché derivada). */
  nextLeafEventYears?: number;
}

const CH = Object.freeze({
  background: 120,
  backgroundPick: 121,
  wind: 122,
  windPick: 123,
  flowerInduction: 124,
  flowerCount: 125,
  fruitSet: 126,
  petal: 127,
  shortShoot: 128,
});

/** Constantes de ingeniería de la caída (no son datos de especie). */
const DROP = Object.freeze({
  /** Hazard de ráfaga por hoja a intensidad 1 y vulnerabilidad 1 (1/año). */
  windRatePerYear: 320,
  /** Vulnerabilidad de una hoja verde frente a una seca (1.5). */
  greenVulnerability: 0.03,
  /** Duración del secado de las hojas de un eje muerto (años). */
  witherYears: 0.05,
  /** Pétalos emitidos como partículas por flor. */
  petalsPerFlower: 3,
});

const popcount = (m: number): number => {
  let x = m >>> 0;
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
};

const scratch = new Float32Array(DETACH_STRIDE);

function emitRecord(
  ctx: OrganContext,
  kind: number,
  at: number,
  pose: Float32Array,
  size: number,
  rgb: readonly [number, number, number],
): void {
  scratch[0] = kind;
  scratch[1] = at;
  for (let k = 0; k < 7; k++) scratch[2 + k] = pose[k]!;
  scratch[9] = size;
  scratch[10] = rgb[0];
  scratch[11] = rgb[1];
  scratch[12] = rgb[2];
  ctx.emit(scratch);
}

const pose = new Float32Array(7);

// ── Hojas ──────────────────────────────────────────────────────────────────────────

/** Forma la cohorte de hojas de un entrenudo recién emitido. */
export function createLeafCohort(
  ctx: OrganContext,
  seg: Segment,
  axis: Axis,
  t: number,
  baseAzimuthRad: number,
): void {
  addLeafCohort(ctx, seg, axis, t, baseAzimuthRad, ctx.species.leaves.perMetamer, null);
}

function addLeafCohort(
  ctx: OrganContext,
  seg: Segment,
  axis: Axis,
  t: number,
  baseAzimuthRad: number,
  leaves: number,
  knownExposure: number | null,
): void {
  const { state: s, species } = ctx;
  const count = Math.min(30, leaves);
  const id = s.nextId++;
  const exposure = knownExposure ?? ctx.light().exposure(seg.end);
  const health = healthFromExposure(exposure);
  const span = species.phenology.senescence[1] - species.phenology.senescence[0];
  const cohort: LeafCohort = {
    id,
    segmentId: seg.id,
    axisId: axis.id,
    bornAtYears: t,
    count,
    attachedMask: count >= 31 ? 0x7fffffff : (1 << count) - 1,
    baseAzimuthRad,
    exposure01: exposure,
    health01: health,
    senescenceAtYears: cohortSenescenceAt(species, s.seed, id, t, exposure, health, seg.end[1]),
    senescenceSpanYears: span,
    withered: false,
    backgroundDrops: 0,
    nextBackgroundDropYears: Infinity,
  };
  scheduleBackgroundDrop(ctx, cohort, t);
  s.leafCohorts[id] = cohort;
  ctx.nextLeafEventYears = Math.min(
    ctx.nextLeafEventYears ?? -Infinity,
    cohort.senescenceAtYears,
    cohort.nextBackgroundDropYears,
  );
}

function scheduleBackgroundDrop(ctx: OrganContext, cohort: LeafCohort, t: number): void {
  const attached = popcount(cohort.attachedMask);
  const rate = ctx.species.leaves.backgroundDropPerYear * attached;
  if (!(rate > 0)) {
    cohort.nextBackgroundDropYears = Infinity;
    return;
  }
  const u = eventUniform(ctx.state.seed, cohort.id, cohort.backgroundDrops, CH.background);
  cohort.nextBackgroundDropYears = t + -Math.log(u) / rate;
}

function detachLeaf(ctx: OrganContext, cohort: LeafCohort, i: number, at: number): void {
  const { state: s, species } = ctx;
  cohort.attachedMask &= ~(1 << i);
  const seg = s.segments[cohort.segmentId];
  if (!seg) return;
  const traits = leafTraits(s.seed, cohort.id, cohort.count);
  leafPose(species, seg, cohort, traits, i, pose, 0);
  emitRecord(
    ctx,
    DETACH_KIND.leaf,
    at,
    pose,
    leafScale(species, cohort, traits, i, at),
    leafColor(species, cohort, traits, i, at),
  );
}

/** Elige la hoja unida k-ésima según `u` y unos pesos. */
function pickAttached(
  mask: number,
  count: number,
  u: number,
  weight: (i: number) => number,
): number {
  let total = 0;
  for (let i = 0; i < count; i++) if ((mask >>> i) & 1) total += weight(i);
  let x = u * total;
  let last = -1;
  for (let i = 0; i < count; i++) {
    if (!((mask >>> i) & 1)) continue;
    last = i;
    x -= weight(i);
    if (x <= 0) return i;
  }
  return last;
}

export function updateLeaves(ctx: OrganContext, t0: number, t1: number, tick: number): void {
  const { state: s, species } = ctx;
  const gust = weeklyGust01(s.environment.wind, s.seed, tick);
  const windy = gust > 0.05;
  // Sin viento y sin ninguna cohorte con eventos pendientes: nada que recorrer.
  if (!windy && t1 < (ctx.nextLeafEventYears ?? -Infinity)) return;
  const fragility = species.leaves.windFragility;
  let next = Infinity;
  for (const cohort of Object.values(s.leafCohorts)) {
    if (cohort.attachedMask === 0) continue;
    next = Math.min(next, cohort.senescenceAtYears, cohort.nextBackgroundDropYears);
    // La mayoría de cohortes no hace nada en un tick: los rasgos se piden solo si hacen falta.
    if (!windy && t1 < cohort.senescenceAtYears && t1 < cohort.nextBackgroundDropYears) continue;
    const traits = leafTraits(s.seed, cohort.id, cohort.count);

    // Caída estacional y de hojas secas (marcescentes hasta la brotación).
    if (t1 >= cohort.senescenceAtYears) {
      for (let i = 0; i < cohort.count; i++) {
        if (!((cohort.attachedMask >>> i) & 1)) continue;
        const p = senescenceProgress(species, cohort, traits, i, t1);
        if (!cohort.withered && isMarcescent(species, traits, i)) {
          if (t1 >= marcescentDropAt(species, cohort, traits, i)) detachLeaf(ctx, cohort, i, t1);
        } else if (p >= 1 + trait(traits, i, LEAF_TRAIT.lag)) {
          detachLeaf(ctx, cohort, i, t1);
        }
      }
      if (cohort.attachedMask === 0) continue;
    }

    // Caída de fondo: un evento cuando vence la espera exponencial de la cohorte.
    if (t1 >= cohort.nextBackgroundDropYears) {
      const u = eventUniform(s.seed, cohort.id, cohort.backgroundDrops, CH.backgroundPick);
      const i = pickAttached(cohort.attachedMask, cohort.count, u, () => 1);
      const at = Math.max(t0, cohort.nextBackgroundDropYears);
      cohort.backgroundDrops += 1;
      if (i >= 0) detachLeaf(ctx, cohort, i, at);
      scheduleBackgroundDrop(ctx, cohort, at);
      if (cohort.attachedMask === 0) continue;
    }

    // Caída por viento: hazard de la cohorte según la ráfaga y lo vulnerable de cada hoja.
    if (windy) {
      const vulnerability = (i: number): number => {
        const p = senescenceProgress(species, cohort, traits, i, t1);
        return p >= 1 ? 1.5 : DROP.greenVulnerability + p * p;
      };
      let sum = 0;
      for (let i = 0; i < cohort.count; i++) {
        if ((cohort.attachedMask >>> i) & 1) sum += vulnerability(i);
      }
      const hazard = fragility * DROP.windRatePerYear * gust * gust * sum * DT_YEARS;
      const u = eventUniform(s.seed, cohort.id, tick >>> 0, CH.wind);
      if (u < 1 - Math.exp(-hazard)) {
        const pick = eventUniform(s.seed, cohort.id, tick >>> 0, CH.windPick);
        const i = pickAttached(cohort.attachedMask, cohort.count, pick, vulnerability);
        if (i >= 0) detachLeaf(ctx, cohort, i, t0 + DT_YEARS * u);
      }
    }
  }
  ctx.nextLeafEventYears = next;
}

/**
 * Brotes cortos (braquiblastos): en la brotación, cada yema lateral latente y viable abre
 * con cierta probabilidad (mayor con luz) una roseta de hojas en su nudo.
 */
export function flushShortShoots(ctx: OrganContext, year: number, t: number): void {
  const { state: s, species } = ctx;
  const program = species.leaves.shortShoots;
  if (!program) return;
  const light = ctx.light();
  const envelope = species.crownEnvelope ? envelopeAt(species.crownEnvelope, t) : null;
  for (const bud of Object.values(s.buds)) {
    if (bud.kind !== 'lateral' || bud.state !== 'dormant' || bud.eligibleFromYear > year) continue;
    // Solo madera joven: los braquiblastos se agotan en ramas viejas.
    if (bud.segmentId === null || year - bud.bornAtYears > program.maxBudAgeYears) continue;
    const axis = s.axes[bud.axisId];
    const seg = s.segments[bud.segmentId];
    if (!axis || axis.woodState !== 'living' || !seg) continue;
    const exposure = light.exposure(seg.end);
    // Con envolvente artística, las rosetas se concentran en la corteza exterior de la copa.
    const shell = envelope
      ? Math.min(1, envelopeSignalFactor(envelopeDistance(envelope, seg.end)))
      : 1;
    if (
      eventUniform(s.seed, bud.id, year, CH.shortShoot) >=
      program.probability * exposure * shell
    ) {
      continue;
    }
    addLeafCohort(ctx, seg, axis, t, bud.azimuthRad, program.leaves, exposure);
  }
}

/** En la brotación: renueva la luz de las perennes y retira cohortes vacías. */
export function refreshLeafCohorts(ctx: OrganContext): void {
  const { state: s, species } = ctx;
  const light = ctx.light();
  for (const cohort of Object.values(s.leafCohorts)) {
    if (cohort.attachedMask === 0) {
      delete s.leafCohorts[cohort.id];
      continue;
    }
    if (species.leaves.habit === 'evergreen' && !cohort.withered) {
      const seg = s.segments[cohort.segmentId];
      if (!seg) continue;
      cohort.exposure01 = light.exposure(seg.end);
      // La salud se filtra: un año de sombra no mata una acícula sana.
      cohort.health01 = 0.6 * cohort.health01 + 0.4 * healthFromExposure(cohort.exposure01);
    }
  }
}

/** Oclusores de sombra de las hojas: hojas unidas y follaje de la última temporada. */
export function leafOccluders(
  s: TreeState,
  species: Species,
  out: { position: Vec3; weight: number }[],
): void {
  const year = yearOf(s.timeYears);
  const per = species.leaves.perMetamer;
  const deciduous = species.leaves.habit === 'deciduous';
  for (const cohort of Object.values(s.leafCohorts)) {
    if (s.axes[cohort.axisId]?.woodState !== 'living') continue;
    const seg = s.segments[cohort.segmentId];
    if (!seg) continue;
    // Caducas: el follaje de la temporada anterior sigue contando en la brotación.
    const lastSeason = deciduous && yearOf(cohort.bornAtYears) >= year - 1;
    const leaves = lastSeason ? cohort.count : popcount(cohort.attachedMask);
    if (leaves === 0) continue;
    out.push({ position: seg.end, weight: (species.leaves.shadeWeight * leaves) / per });
  }
}

export function attachedLeafCount(s: TreeState): number {
  let n = 0;
  for (const c of Object.values(s.leafCohorts)) n += popcount(c.attachedMask);
  return n;
}

// ── Flores ─────────────────────────────────────────────────────────────────────────

/**
 * Inducción floral: forma yemas florales en los entrenudos elegibles del año `year`.
 * Previos (almendro): florecen el año siguiente. Del año (roble): florecen ya.
 */
export function initiateFlowers(ctx: OrganContext, year: number, t: number): void {
  const { state: s, species } = ctx;
  const program = species.flowering;
  if (!program || year < program.firstFloweringYear) return;
  const light = ctx.light();
  const ramp = Math.min(1, (year - program.firstFloweringYear + 1) / 4);
  const bloomYear = program.position === 'previousShoot' ? year + 1 : year;
  for (const seg of Object.values(s.segments)) {
    if (yearOf(seg.bornAtYears) !== year) continue;
    const axis = s.axes[seg.axisId];
    if (!axis || axis.woodState !== 'living') continue;
    const exposure = light.exposure(seg.end);
    const p = program.intensity * ramp * (0.3 + 0.7 * exposure);
    if (eventUniform(s.seed, seg.id, year, CH.flowerInduction) >= p) continue;
    const extra = eventUniform(s.seed, seg.id, year, CH.flowerCount);
    const count = Math.min(program.maxPerNode, 1 + Math.floor(extra * program.maxPerNode));
    const id = s.nextId++;
    const cohort: FlowerCohort = {
      id,
      segmentId: seg.id,
      axisId: axis.id,
      initiatedAtYears: t,
      bloomYear,
      count,
      openAtYears: cohortOpenAt(program, s.seed, id, bloomYear, exposure),
      exposure01: exposure,
      shedMask: 0,
      done: false,
    };
    s.flowerCohorts[id] = cohort;
  }
}

export function updateFlowers(ctx: OrganContext, t1: number): void {
  const { state: s, species } = ctx;
  const program = species.flowering;
  if (!program) return;
  for (const cohort of Object.values(s.flowerCohorts)) {
    if (cohort.done) continue;
    if (t1 < cohort.openAtYears) continue;
    const seg = s.segments[cohort.segmentId];
    if (!seg) {
      cohort.done = true;
      continue;
    }
    for (let i = 0; i < cohort.count; i++) {
      if ((cohort.shedMask >>> i) & 1) continue;
      const shedAt = flowerShedAt(program, s.seed, cohort, i);
      if (t1 < shedAt) continue;
      cohort.shedMask |= 1 << i;
      emitPetals(ctx, seg, cohort, i, shedAt);
      setFruit(ctx, cohort, i, shedAt);
    }
    if (popcount(cohort.shedMask) === cohort.count) cohort.done = true;
  }
}

function emitPetals(
  ctx: OrganContext,
  seg: Segment,
  cohort: FlowerCohort,
  i: number,
  at: number,
): void {
  const { state: s, species } = ctx;
  const program = species.flowering!;
  if (program.petals === 0) return;
  flowerPose(s.seed, seg, cohort, i, program.sizeM, pose, 0);
  const rgb = hexToLinear(program.colors.petal);
  const n = Math.min(program.petals, DROP.petalsPerFlower);
  for (let k = 0; k < n; k++) {
    const jitter = eventUniform(s.seed, cohort.id, i * 8 + k, CH.petal) - 0.5;
    pose[0] = pose[0]! + jitter * program.sizeM * 0.6;
    pose[2] = pose[2]! - jitter * program.sizeM * 0.4;
    emitRecord(ctx, DETACH_KIND.petal, at + k * 0.002, pose, program.sizeM * 0.5, rgb);
  }
}

function setFruit(ctx: OrganContext, cohort: FlowerCohort, i: number, at: number): void {
  const { state: s, species } = ctx;
  const program = species.fruiting;
  if (!program) return;
  const p = program.setProbability * (0.4 + 0.6 * cohort.exposure01);
  if (eventUniform(s.seed, cohort.id, i, CH.fruitSet) >= p) return;
  const id = s.nextId++;
  const plan = fruitDropPlan(program, s.seed, id, at);
  const fruit: FruitState = {
    id,
    segmentId: cohort.segmentId,
    axisId: cohort.axisId,
    flowerCohortId: cohort.id,
    index: i,
    setAtYears: at,
    growth01: 0,
    massKg: fruitMass(program, 0),
    ripe: false,
    dropAtYears: plan.dropAtYears,
    earlyDrop: plan.earlyDrop,
  };
  s.fruits[id] = fruit;
}

// ── Frutos ─────────────────────────────────────────────────────────────────────────

export function updateFruits(ctx: OrganContext, t1: number): void {
  const { state: s, species } = ctx;
  const program = species.fruiting;
  if (!program) return;
  for (const fruit of Object.values(s.fruits)) {
    fruit.growth01 = fruit.earlyDrop
      ? Math.min(0.25, fruitGrowth(program, fruit, t1))
      : fruitGrowth(program, fruit, t1);
    fruit.massKg = fruitMass(program, fruit.growth01);
    fruit.ripe = t1 >= yearOf(fruit.setAtYears) + program.ripenPhase;
    if (t1 >= fruit.dropAtYears) dropFruit(ctx, fruit, fruit.dropAtYears);
  }
}

function dropFruit(ctx: OrganContext, fruit: FruitState, at: number): void {
  const { state: s, species } = ctx;
  const program = species.fruiting!;
  const seg = s.segments[fruit.segmentId];
  if (seg) {
    fruitPose(s.seed, seg, fruit, pose, 0);
    const size = program.sizeM * (0.25 + 0.75 * fruit.growth01);
    emitRecord(ctx, DETACH_KIND.fruit, at, pose, size, fruitColor(program, fruit, at));
  }
  delete s.fruits[fruit.id];
}

/** Retira cohortes florales terminadas. */
export function pruneFlowers(s: TreeState): void {
  for (const c of Object.values(s.flowerCohorts)) if (c.done) delete s.flowerCohorts[c.id];
}

// ── Muerte y desprendimiento de ejes ───────────────────────────────────────────────

/** Ejes que acaban de morir: sus hojas se secan y caen, flores y frutos se pierden. */
export function onAxesDied(ctx: OrganContext, t: number): void {
  const s = ctx.state;
  ctx.nextLeafEventYears = -Infinity; // las hojas secas tienen eventos ya
  const dead = (axisId: number): boolean => s.axes[axisId]?.woodState !== 'living';
  for (const cohort of Object.values(s.leafCohorts)) {
    if (cohort.withered || !dead(cohort.axisId)) continue;
    cohort.withered = true;
    cohort.senescenceAtYears = t;
    cohort.senescenceSpanYears = DROP.witherYears;
  }
  for (const c of Object.values(s.flowerCohorts)) if (dead(c.axisId)) c.done = true;
  for (const f of Object.values(s.fruits)) if (dead(f.axisId)) dropFruit(ctx, f, t);
}

/** Tras un desprendimiento: elimina los órganos cuyo entrenudo ya no existe. */
export function removeOrphanOrgans(s: TreeState): void {
  for (const c of Object.values(s.leafCohorts)) {
    if (!s.segments[c.segmentId]) delete s.leafCohorts[c.id];
  }
  for (const c of Object.values(s.flowerCohorts)) {
    if (!s.segments[c.segmentId]) delete s.flowerCohorts[c.id];
  }
  for (const f of Object.values(s.fruits)) if (!s.segments[f.segmentId]) delete s.fruits[f.id];
}

export { popcount };
