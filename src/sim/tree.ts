/**
 * Motor de crecimiento (fases 2.8-2.10).
 *
 * Ciclo por tick semanal (especificación §11), en orden:
 *   1. Al iniciar la liberación de yemas: campo de luz sobre el estado previo, señales de
 *      puntas a base, presupuesto anual en la base y reparto de base a puntas (Borchert-Honda).
 *   2. Durante la liberación: activación de yemas laterales por hazard con umbral persistente.
 *   3. Durante la elongación: emisión progresiva de metámeros y alargamiento de entrenudos.
 *   4. Durante la ventana radial: engrosamiento monotónico hacia el objetivo tipo pipe.
 *   5. Al final de la estación: supervivencia por déficit sostenido y caída de madera muerta.
 *
 * El estado se muta en el sitio por rendimiento, pero cada fase decide con datos fijados
 * antes de aplicar cambios (ids en orden estable, sin depender del orden de recorrido).
 * Las instantáneas para rebobinar se toman con structuredClone fuera del bucle.
 */
import {
  accumulateCredit,
  advanceHazard,
  allocateBorchertHonda,
  allocateWeighted,
  thresholdFromUniform,
} from './allocation.ts';
import { DT_YEARS, crosses, inWindow, seasonPhase, windowProgress, yearOf } from './clock.ts';
import { DEFAULT_SHADOW, ShadowGrid, type LightField } from './light.ts';
import {
  activationBias,
  evaluateRoleProgram,
  getArchetype,
  type Archetype,
  type AxisRole,
  type MorphologicalFrame,
} from './morphotype.ts';
import {
  DETACH_STRIDE,
  createLeafCohort,
  flushShortShoots,
  initiateFlowers,
  leafOccluders,
  onAxesDied,
  pruneFlowers,
  refreshLeafCohorts,
  removeOrphanOrgans,
  updateFlowers,
  updateFruits,
  updateLeaves,
  type OrganContext,
} from './organs.ts';
import type { PhenologyCalendar } from './phenology.ts';
import { genericSpeciesId, getSpecies, isSpeciesId, type Species } from './species.ts';
import { branchBirthDirection, inclinationTargetDirection, steerDirection } from './orientation.ts';
import { Channel, eventSigned, eventUniform, smoothNoise1D } from './random.ts';
import {
  DEFAULT_LIMITS,
  type Axis,
  type Bud,
  type GrowthUnit,
  type Segment,
  type TreeEvent,
  type TreeLimits,
  type TreeState,
} from './types.ts';
import {
  UP,
  add,
  anyPerpendicular,
  normalizeOr,
  projectOnPlane,
  scale,
  transportNormal,
  type Vec3,
} from './vec3.ts';
import type { WindSettings } from './wind.ts';
import { pipeTargetRadius } from './wood.ts';

/** Holgura sobre el sustrato por debajo de la cual un entrenudo no puede bajar (m). */
const SOIL_CLEARANCE_M = 0.015;

export const MODEL_VERSION = 'silvum-core-0.3.0';

/** Constantes de ingeniería del motor (no son parámetros de especie). */
const ENGINE = Object.freeze({
  /** Tiempo para que un entrenudo alcance su longitud final (años). */
  internodeExpansionYears: 0.05,
  /** Longitud inicial de un entrenudo recién emitido, como fracción de la final. */
  initialLengthFraction: 0.15,
  /** Exposición por debajo de la cual se acumula déficit. */
  deficitExposure: 0.15,
  /** Peso del año actual en el filtro del déficit sostenido. */
  deficitFilter: 0.5,
  /** Tasa base de mortalidad por déficit (1/año). */
  baseMortalityPerYear: 1.0,
  /** Años que la madera muerta permanece unida antes de desprenderse. */
  deadWoodRetentionYears: 3,
  /** Desprendimientos visuales retenidos como máximo entre dos publicaciones. */
  maxPendingDetachments: 6000,
});

export interface SimulationOptions {
  /** Especie (preset) o, para depurar, la especie genérica de un arquetipo. */
  speciesId?: string;
  archetypeId?: string;
  seed: number;
  limits?: TreeLimits;
}

/** Resuelve el id de especie a partir de las opciones (`speciesId` tiene prioridad). */
export function resolveSpeciesId(options: { speciesId?: string; archetypeId?: string }): string {
  if (options.speciesId) return options.speciesId;
  if (options.archetypeId) {
    return isSpeciesId(options.archetypeId)
      ? options.archetypeId
      : genericSpeciesId(options.archetypeId);
  }
  throw new Error('Falta la especie o el arquetipo');
}

/** Simulación de un individuo: estado serializable + caché no serializable (campo de luz). */
export class TreeSimulation {
  state: TreeState;
  readonly species: Species;
  readonly archetype: Archetype;
  readonly calendar: PhenologyCalendar;
  readonly limits: TreeLimits;
  private light: LightField | null = null;
  private lightRevision = -1;
  /** Yemas en el estado, contadas una vez por tick de elongación (evita O(n²)). */
  private budCount = 0;
  /** Altura del árbol al empezar el tick de elongación (derivada del estado). */
  private treeHeight = 0;
  /** Desprendimientos visuales pendientes de publicar (fuera del estado biológico). */
  private detached: Float32Array = new Float32Array(256 * DETACH_STRIDE);
  private detachedCount = 0;
  private readonly organs: OrganContext;

  constructor(options: SimulationOptions | { state: TreeState; limits?: TreeLimits }) {
    if ('state' in options) {
      this.state = options.state;
    } else {
      this.state = createTreeState(resolveSpeciesId(options), options.seed);
    }
    this.species = getSpecies(this.state.speciesId);
    this.archetype = {
      morphotype: getArchetype(this.species.archetypeId).morphotype,
      scale: this.species.resolvedScale,
    };
    this.calendar = this.species.phenology;
    this.limits = options.limits ?? DEFAULT_LIMITS;
    const state = (): TreeState => this.state;
    this.organs = {
      get state() {
        return state();
      },
      species: this.species,
      light: () => this.lightField(),
      emit: (record) => this.pushDetachment(record),
    };
  }

  private pushDetachment(record: Float32Array): void {
    if (this.detachedCount >= ENGINE.maxPendingDetachments) {
      // Se conservan los más recientes: se descarta la mitad más antigua de una vez.
      const keep = this.detachedCount >> 1;
      this.detached.copyWithin(
        0,
        (this.detachedCount - keep) * DETACH_STRIDE,
        this.detachedCount * DETACH_STRIDE,
      );
      this.detachedCount = keep;
    }
    const need = (this.detachedCount + 1) * DETACH_STRIDE;
    if (need > this.detached.length) {
      const grown = new Float32Array(this.detached.length * 2);
      grown.set(this.detached);
      this.detached = grown;
    }
    this.detached.set(record, this.detachedCount * DETACH_STRIDE);
    this.detachedCount += 1;
  }

  /** Entrega y vacía los desprendimientos visuales acumulados desde la última llamada. */
  drainDetachments(): Float32Array {
    const out = this.detached.slice(0, this.detachedCount * DETACH_STRIDE);
    this.detachedCount = 0;
    return out;
  }

  /** Cambia el viento en el instante actual (evento del entorno, reproducible). */
  setWind(wind: WindSettings): void {
    const s = this.state;
    s.environment = { ...s.environment, wind: { ...wind } };
    s.stateRevision += 1;
    pushEvent(s, this.limits, {
      timeYears: s.timeYears,
      kind: 'environment-changed',
      id: 0,
      detail: `viento ${wind.intensity01.toFixed(2)}`,
    });
  }

  /** Avanza un tick biológico (una semana). */
  step(): void {
    const s = this.state;
    const t0 = s.timeYears;
    const t1 = t0 + DT_YEARS;
    const phase = seasonPhase(t0);
    const year = yearOf(t0);
    const cal = this.calendar;
    s.developmentalStage01 = Math.min(1, t0 / this.archetype.scale.maturityYears);

    if (crosses(t0, t1, cal.budRelease[0])) this.beginFlush(year);
    if (inWindow(phase, cal.budRelease)) this.releaseLateralBuds(t0, phase);

    let geometryChanged = false;
    if (inWindow(phase, cal.elongation)) {
      this.emitMetamers(t0, phase);
      geometryChanged = this.expandInternodes() || geometryChanged;
    }
    if (crosses(t0, t1, cal.elongation[1])) {
      this.completeElongation(year);
      geometryChanged = true;
    }
    if (inWindow(phase, cal.radialGrowth)) this.thicken();
    if (crosses(t0, t1, cal.survivalAt)) {
      this.evaluateSurvival(t0);
      geometryChanged = true;
    }
    if (geometryChanged) updatePositions(s);

    // Órganos: inducción floral, flores, frutos y hojas (después de la madera del tick).
    const flowering = this.species.flowering;
    if (flowering) {
      const induction =
        flowering.position === 'previousShoot' ? flowering.inductionPhase : flowering.bloom[0];
      if (crosses(t0, t1, induction)) initiateFlowers(this.organs, year, t0);
      updateFlowers(this.organs, t1);
    }
    updateFruits(this.organs, t1);
    updateLeaves(this.organs, t0, t1, s.completedTick);

    s.timeYears = t1;
    s.completedTick += 1;
    s.stateRevision += 1;
  }

  /** Avanza `years` años de tiempo biológico. */
  advanceYears(years: number): void {
    const ticks = Math.round(years / DT_YEARS);
    for (let i = 0; i < ticks; i++) this.step();
  }

  private frameFor(role: AxisRole): MorphologicalFrame {
    const frame = evaluateRoleProgram(
      this.species.morphology.roles?.[role] ?? this.archetype.morphotype.roles[role],
      this.state.developmentalStage01,
    );
    const m = this.species.morphology;
    const offset = m.inclinationOffsetDeg[role] ?? 0;
    if (offset === 0 && m.branchingFactor === 1) return frame;
    return {
      ...frame,
      targetInclinationDeg: Math.max(0, Math.min(180, frame.targetInclinationDeg + offset)),
      branchingIntensity: Math.max(0, Math.min(1, frame.branchingIntensity * m.branchingFactor)),
    };
  }

  private lightField(): LightField {
    if (!this.light || this.lightRevision < 0) {
      this.light = buildLightField(this.state);
      this.lightRevision = this.state.stateRevision;
    }
    return this.light;
  }

  // ── 1. Liberación: luz, señales y reparto ────────────────────────────────────────────
  private beginFlush(year: number): void {
    const s = this.state;
    const { scale: sc } = this.archetype;
    // Luz evaluada sobre el estado previo; las sombras de órganos nuevos afectan al año siguiente.
    this.light = buildLightField(s);
    this.lightRevision = s.stateRevision;
    const light = this.light;
    // Con la luz ya fijada: cohortes vacías fuera, perennes con su nueva luz.
    refreshLeafCohorts(this.organs);
    pruneFlowers(s);
    flushShortShoots(this.organs, year, s.timeYears);

    const budsBySegment = new Map<number | null, Bud[]>();
    for (const bud of Object.values(s.buds)) {
      if (bud.state === 'dead') continue;
      const axis = s.axes[bud.axisId];
      if (!axis || axis.woodState !== 'living') continue;
      // Yemas latentes que dejan de ser viables.
      if (bud.kind === 'lateral' && year - bud.bornAtYears > sc.budViabilityYears) {
        bud.state = 'dead';
        continue;
      }
      const pos = budPosition(s, bud);
      bud.exposure01 = light.exposure(pos);
      bud.allocated = 0;
      if (bud.kind === 'lateral') {
        // Nuevo episodio de liberación: nuevo umbral persistente.
        bud.releaseEpisode += 1;
        bud.hazard = {
          accumulated: 0,
          threshold: thresholdFromUniform(
            eventUniform(s.seed, bud.id, bud.releaseEpisode, Channel.activationThreshold),
          ),
          activated: false,
        };
      }
      const list = budsBySegment.get(bud.segmentId) ?? [];
      list.push(bud);
      budsBySegment.set(bud.segmentId, list);
    }

    const eligible = (b: Bud): boolean => b.state === 'dormant' && b.eligibleFromYear <= year;
    // Señal de oportunidad de cada yema: la terminal aporta su exposición; una lateral la
    // modula por su posición en la unidad, la intensidad de ramificación del portador y el
    // control apical de un ápice vivo sobre las yemas de su último brote (S01, S02).
    const knots =
      this.species.morphology.activationBiasKnots ??
      this.archetype.morphotype.branchingZone.activationBiasKnots;
    this.applyArchitecture(year);
    const signal = new Map<number, number>();
    for (const list of budsBySegment.values()) {
      for (const bud of list) {
        if (!eligible(bud)) continue;
        if (bud.kind === 'terminal') {
          signal.set(bud.id, bud.exposure01);
          continue;
        }
        const axis = s.axes[bud.axisId]!;
        const apex = axis.terminalBudId !== null ? s.buds[axis.terminalBudId] : undefined;
        const recent = year - bud.bornAtYears <= 1;
        const inhibited = recent && apex !== undefined && apex.state !== 'dead';
        const propensity =
          activationBias(knots, bud.positionInUnit01) *
          this.frameFor(axis.role).branchingIntensity *
          (inhibited ? 1 - sc.apicalInhibition : 1);
        signal.set(bud.id, bud.exposure01 * propensity);
      }
    }
    const sig = (b: Bud): number => signal.get(b.id) ?? 0;
    const segments = Object.values(s.segments)
      .filter((g) => s.axes[g.axisId]?.woodState === 'living')
      .sort((a, b) => a.id - b.id);

    // Señales de puntas a base (ids descendentes: los hijos nacen después que los padres).
    const qMain = new Map<number, number>();
    const qLat = new Map<number, number>();
    const qSeg = new Map<number, number>();
    for (let i = segments.length - 1; i >= 0; i--) {
      const g = segments[i]!;
      let main = 0;
      let lat = 0;
      for (const childId of g.childSegmentIds) {
        const child = s.segments[childId];
        if (!child) continue;
        const q = qSeg.get(childId) ?? 0;
        if (child.axisId === g.axisId) main += q;
        else lat += q;
      }
      for (const bud of budsBySegment.get(g.id) ?? []) {
        if (!eligible(bud)) continue;
        if (bud.kind === 'terminal' && bud.axisId === g.axisId) main += sig(bud);
        else lat += sig(bud);
      }
      qMain.set(g.id, main);
      qLat.set(g.id, lat);
      qSeg.set(g.id, main + lat);
    }

    // Raíz: primer entrenudo del tronco, o la yema de la semilla si aún no hay madera.
    const trunk = s.axes[rootAxisId(s)];
    const rootSegId = trunk?.segmentIds[0];
    const seedBud = (budsBySegment.get(null) ?? []).find(eligible);
    const qBase = rootSegId !== undefined ? (qSeg.get(rootSegId) ?? 0) : seedBud ? sig(seedBud) : 0;
    const budget = sc.vigorAlpha * qBase; // presupuesto anual (modelo por brote)
    s.lastBaseExposure = qBase;
    s.lastBudget = budget;

    if (rootSegId === undefined) {
      if (seedBud) seedBud.allocated = budget;
    } else {
      // Reparto de base a puntas (ids ascendentes).
      const incoming = new Map<number, number>([[rootSegId, budget]]);
      for (const g of segments) {
        const v = incoming.get(g.id) ?? 0;
        if (v <= 0) continue;
        const axis = s.axes[g.axisId]!;
        const lambda = this.frameFor(axis.role).apicalControlLambda;
        const split = allocateBorchertHonda(v, qMain.get(g.id) ?? 0, qLat.get(g.id) ?? 0, lambda);

        const mainChild = g.childSegmentIds.find((id) => s.segments[id]?.axisId === g.axisId);
        const buds = (budsBySegment.get(g.id) ?? []).filter(eligible);
        if (mainChild !== undefined) {
          incoming.set(mainChild, (incoming.get(mainChild) ?? 0) + split.main);
        } else {
          const terminal = buds.find((b) => b.kind === 'terminal' && b.axisId === g.axisId);
          if (terminal) terminal.allocated += split.main;
        }
        // Grupo lateral: primero el par principal/grupo, después pesos normalizados (§5).
        const lateralSinks: { kind: 'seg' | 'bud'; id: number; signal: number }[] = [];
        for (const childId of g.childSegmentIds) {
          if (s.segments[childId]?.axisId !== g.axisId) {
            lateralSinks.push({ kind: 'seg', id: childId, signal: qSeg.get(childId) ?? 0 });
          }
        }
        for (const b of buds) {
          if (!(b.kind === 'terminal' && b.axisId === g.axisId)) {
            lateralSinks.push({ kind: 'bud', id: b.id, signal: sig(b) });
          }
        }
        const shares = allocateWeighted(
          split.lateral,
          lateralSinks.map((x) => ({ signal: x.signal, weight: 1 })),
        );
        lateralSinks.forEach((sink, i) => {
          const a = shares.allocations[i] ?? 0;
          if (sink.kind === 'seg') incoming.set(sink.id, (incoming.get(sink.id) ?? 0) + a);
          else {
            const b = s.buds[sink.id];
            if (b) b.allocated += a;
          }
        });
      }
    }

    // Yemas terminales: brotan al inicio si su crédito alcanza al menos un metámero.
    // Yemas laterales: fijan su tasa de activación para la ventana de liberación.
    for (const bud of Object.values(s.buds)) {
      if (!eligible(bud)) continue;
      const axis = s.axes[bud.axisId];
      if (!axis || axis.woodState !== 'living') continue;
      if (bud.kind === 'terminal') {
        this.startShoot(bud, axis, s.timeYears);
      } else {
        const carrier = this.frameFor(axis.role);
        const vigor = Math.min(1, bud.allocated / sc.metamerCost);
        const bias = activationBias(knots, bud.positionInUnit01);
        // La luz entra a través del presupuesto asignado; la tasa se modula por posición,
        // intensidad de ramificación del portador y vigor disponible.
        bud.activationRatePerYear =
          sc.baseActivationRatePerYear * carrier.branchingIntensity * bias * vigor;
      }
    }
  }

  /**
   * Mecanismos de arquitectura de la especie al inicio de la brotación, antes de calcular
   * señales: pérdida de dominancia del líder y aborto de yemas terminales. Una terminal
   * muerta deja sin inhibición a las laterales altas de su último brote, que la relevan.
   */
  /** Año (por semilla) en que el líder pierde la dominancia, o Infinity. */
  private leaderLossYear(): number {
    const lossAt = this.species.architecture.leaderLossYears;
    if (!lossAt) return Infinity;
    const u = eventUniform(this.state.seed, 0, 0, Channel.leaderLoss);
    return Math.round(lossAt[0] + (lossAt[1] - lossAt[0]) * u);
  }

  private applyArchitecture(year: number): void {
    const s = this.state;
    const arch = this.species.architecture;
    const trunkId = rootAxisId(s);
    const lossYear = this.leaderLossYear();
    for (const bud of Object.values(s.buds)) {
      if (bud.kind !== 'terminal' || bud.state !== 'dormant') continue;
      const axis = s.axes[bud.axisId];
      if (!axis || axis.woodState !== 'living' || axis.terminalBudId !== bud.id) continue;
      if (bud.segmentId === null) continue; // la yema de la semilla nunca aborta
      let dies = false;
      if (axis.id === trunkId) dies = year >= lossYear;
      else {
        const p = arch.terminalAbortion[axis.role] ?? 0;
        dies = p > 0 && eventUniform(s.seed, bud.id, year, Channel.terminalAbortion) < p;
      }
      if (dies) {
        bud.state = 'dead';
        if (axis.id === trunkId) {
          pushEvent(s, this.limits, {
            timeYears: s.timeYears,
            kind: 'leader-lost',
            id: axis.id,
          });
        }
      }
    }
  }

  // ── 2. Activación de laterales ──────────────────────────────────────────────────────
  private releaseLateralBuds(t0: number, _phase: number): void {
    const s = this.state;
    const year = yearOf(t0);
    const activated: { bud: Bud; at: number }[] = [];
    for (const bud of Object.values(s.buds)) {
      if (bud.kind !== 'lateral' || bud.state !== 'dormant' || bud.eligibleFromYear > year)
        continue;
      if (!(bud.activationRatePerYear > 0) || bud.hazard.activated) continue;
      const step = advanceHazard(bud.hazard, bud.activationRatePerYear, DT_YEARS);
      bud.hazard = step.state;
      if (step.crossedAtFraction !== null) {
        activated.push({ bud, at: t0 + step.crossedAtFraction * DT_YEARS });
      }
    }
    // Aplicar tras decidir, en orden estable de id.
    activated.sort((a, b) => a.bud.id - b.bud.id);
    for (const { bud, at } of activated) this.activateLateral(bud, at);
  }

  private activateLateral(bud: Bud, atYears: number): void {
    const s = this.state;
    const { scale: sc } = this.archetype;
    const parentAxis = s.axes[bud.axisId];
    const carrierSeg = bud.segmentId !== null ? s.segments[bud.segmentId] : undefined;
    if (!parentAxis || !carrierSeg) return;
    const credit = accumulateCredit(bud.growthCredit, bud.allocated, sc.metamerCost);
    const metamers = Math.min(credit.units, sc.maxMetamersPerShoot);
    if (metamers < 1) {
      bud.growthCredit = credit.carry;
      bud.allocated = 0;
      return; // sin crédito suficiente: espera al siguiente episodio
    }
    const role = childRole(parentAxis.role, metamers / sc.maxMetamersPerShoot);
    const frame = this.frameFor(role);
    const birth = branchBirthDirection(
      carrierSeg.direction,
      carrierSeg.frameU,
      bud.azimuthRad,
      (frame.angleAtBirthDeg * Math.PI) / 180,
    );
    const azimuth = normalizeOr(projectOnPlane(birth, UP), anyPerpendicular(UP));
    const axis = newAxis(s, {
      parentAxisId: parentAxis.id,
      parentSegmentId: carrierSeg.id,
      role,
      botanicalOrder: parentAxis.botanicalOrder + 1,
      bornAtYears: atYears,
      preferredAzimuth: azimuth,
    });
    bud.axisId = axis.id;
    bud.kind = 'terminal';
    bud.heading = birth;
    axis.terminalBudId = bud.id;
    pushEvent(s, this.limits, { timeYears: atYears, kind: 'axis-born', id: axis.id, detail: role });
    this.startShoot(bud, axis, atYears, metamers, credit.carry);
  }

  /** Abre una unidad de crecimiento en una yema terminal. */
  private startShoot(
    bud: Bud,
    axis: Axis,
    atYears: number,
    presetMetamers?: number,
    presetCarry?: number,
  ): void {
    const s = this.state;
    const { scale: sc } = this.archetype;
    let metamers = presetMetamers;
    let carry = presetCarry;
    if (metamers === undefined || carry === undefined) {
      const credit = accumulateCredit(bud.growthCredit, bud.allocated, sc.metamerCost);
      metamers = Math.min(credit.units, sc.maxMetamersPerShoot);
      carry = credit.carry;
    }
    bud.allocated = 0;
    bud.growthCredit = Math.min(carry, sc.metamerCost); // el crédito no se acumula sin límite
    if (metamers < 1) return;
    const gu: GrowthUnit = {
      id: s.nextId++,
      axisId: axis.id,
      year: yearOf(atYears),
      startedAtYears: atYears,
      plannedMetamers: metamers,
      emittedMetamers: 0,
      segmentIds: [],
      elongationComplete: false,
    };
    s.growthUnits[gu.id] = gu;
    axis.growthUnitIds.push(gu.id);
    bud.state = 'growing';
    pushEvent(s, this.limits, { timeYears: atYears, kind: 'bud-activated', id: bud.id });
  }

  // ── 3. Elongación ───────────────────────────────────────────────────────────────────
  private emitMetamers(t0: number, phase: number): void {
    const s = this.state;
    // Las claves enteras de un objeto se recorren en orden ascendente: orden estable por id.
    const growing = Object.values(s.growthUnits).filter((gu) => !gu.elongationComplete);
    let segmentCount = Object.keys(s.segments).length;
    this.budCount = Object.keys(s.buds).length;
    this.treeHeight = 0;
    for (const g of Object.values(s.segments)) {
      if (g.end[1] > this.treeHeight) this.treeHeight = g.end[1];
    }
    for (const gu of growing) {
      const axis = s.axes[gu.axisId];
      if (!axis || axis.woodState !== 'living') {
        gu.elongationComplete = true;
        continue;
      }
      const startPhase = Math.max(this.calendar.elongation[0], seasonPhase(gu.startedAtYears));
      const window: readonly [number, number] = [startPhase, this.calendar.elongation[1]];
      const progress = windowProgress(phase + DT_YEARS, window);
      const due = Math.min(gu.plannedMetamers, Math.ceil(gu.plannedMetamers * progress - 1e-9));
      while (gu.emittedMetamers < due) {
        if (segmentCount >= this.limits.maxSegments) {
          if (!s.capacityReached) {
            s.capacityReached = true;
            pushEvent(s, this.limits, {
              timeYears: t0,
              kind: 'capacity-reached',
              id: 0,
              detail: `${this.limits.maxSegments} entrenudos`,
            });
          }
          return;
        }
        this.emitOne(gu, axis, t0);
        segmentCount += 1;
      }
    }
  }

  private emitOne(gu: GrowthUnit, axis: Axis, t0: number): void {
    const s = this.state;
    const { scale: sc, morphotype } = this.archetype;
    const bud = axis.terminalBudId !== null ? s.buds[axis.terminalBudId] : undefined;
    if (!bud) return;
    const parent = bud.segmentId !== null ? s.segments[bud.segmentId] : undefined;
    const tangent: Vec3 = bud.heading ?? parent?.direction ?? UP;
    const basePos: Vec3 = parent ? parent.end : [0, 0, 0];
    const frame = this.frameFor(axis.role);
    const light = this.lightField();

    // Plagiotropía creciente hacia la base de la copa: las ramas bajas se abren más.
    const spread =
      axis.role === 'trunk' || this.treeHeight <= 0
        ? 0
        : this.species.morphology.lowerCrownSpreadDeg *
          Math.max(0, 1 - Math.max(0, basePos[1]) / this.treeHeight);
    const inclinationDeg = Math.min(
      Math.max(95, frame.targetInclinationDeg),
      frame.targetInclinationDeg + spread,
    );
    const target = inclinationTargetDirection(
      tangent,
      UP,
      axis.preferredAzimuth,
      (inclinationDeg * Math.PI) / 180,
    );
    const noisePos = axis.metamerCount * 0.35;
    const noise = scale(
      [
        smoothNoise1D(s.seed, axis.id, noisePos, Channel.headingNoiseX),
        0,
        smoothNoise1D(s.seed, axis.id, noisePos, Channel.headingNoiseZ),
      ],
      sc.headingNoise,
    );
    const height = Math.max(0, basePos[1]);
    const jitter = 1 + 0.15 * eventSigned(s.seed, gu.id, gu.emittedMetamers, Channel.lengthJitter);
    const lengthM =
      (sc.internodeLengthM * sc.roleLengthFactor[axis.role] * jitter) /
      (1 + height / sc.heightHalvingM);
    const steered = steerDirection({
      tangent,
      lightDirection: light.favorableDirection(basePos),
      targetDirection: target,
      noise,
      weights: {
        heading: frame.tropismWeights.headingPersistence,
        light: frame.tropismWeights.light,
        target: frame.tropismWeights.targetOrientation,
      },
      segmentLengthM: lengthM,
      maxTurnRadPerM: sc.maxTurnRadPerM,
    });
    // El sustrato es un obstáculo (adelanto de 3.3): ningún entrenudo crece por debajo de él.
    const direction: Vec3 =
      basePos[1] + steered[1] * lengthM < SOIL_CLEARANCE_M && steered[1] < 0
        ? normalizeOr([steered[0], 0, steered[2]], anyPerpendicular(UP))
        : steered;
    const parentFrame = parent?.frameU ?? anyPerpendicular(tangent);
    const frameU = transportNormal(parentFrame, parent?.direction ?? tangent, direction);

    const seg: Segment = {
      id: s.nextId++,
      axisId: axis.id,
      growthUnitId: gu.id,
      metamerIndex: gu.emittedMetamers,
      parentSegmentId: parent?.id ?? null,
      childSegmentIds: [],
      bornAtYears: t0,
      direction,
      frameU,
      lengthM: lengthM * ENGINE.initialLengthFraction,
      targetLengthM: lengthM,
      radiusM: sc.terminalRadiusM,
      start: basePos,
      end: add(basePos, scale(direction, lengthM * ENGINE.initialLengthFraction)),
    };
    s.segments[seg.id] = seg;
    if (parent) parent.childSegmentIds.push(seg.id);
    axis.segmentIds.push(seg.id);
    axis.metamerCount += 1;
    gu.segmentIds.push(seg.id);
    gu.emittedMetamers += 1;
    bud.segmentId = seg.id;
    bud.heading = null;
    // Hojas del nudo: la primera con el azimut de la yema axilar que subtiende.
    createLeafCohort(
      this.organs,
      seg,
      axis,
      t0,
      (((axis.phyllotaxisIndex * sc.divergenceDeg) % 360) * Math.PI) / 180,
    );

    // Yemas axilares: una por nudo con divergencia explícita, o cohorte al final del brote.
    const cohort = morphotype.branchingZone.illustrativeCohortAzimuthDeg;
    const position = gu.plannedMetamers > 1 ? seg.metamerIndex / (gu.plannedMetamers - 1) : 1;
    if (cohort.length === 0) {
      this.addLateralBud(axis, seg, t0, position, axis.phyllotaxisIndex * sc.divergenceDeg);
    } else if (gu.emittedMetamers === gu.plannedMetamers) {
      const offset = 360 * eventUniform(s.seed, gu.id, 0, Channel.phyllotaxisStart);
      for (const az of cohort) this.addLateralBud(axis, seg, t0, 1, az + offset);
    }
  }

  private addLateralBud(
    axis: Axis,
    seg: Segment,
    t0: number,
    position01: number,
    azimuthDeg: number,
  ): void {
    const s = this.state;
    if (this.budCount >= this.limits.maxBuds) return;
    const id = s.nextId++;
    const jitter = 12 * eventSigned(s.seed, id, 0, Channel.azimuthJitter);
    s.buds[id] = newBud(id, axis.id, seg.id, 'lateral', t0, yearOf(t0) + 1, {
      azimuthRad: (((azimuthDeg + jitter) % 360) * Math.PI) / 180,
      positionInUnit01: position01,
    });
    axis.phyllotaxisIndex += 1;
    this.budCount += 1;
  }

  private expandInternodes(): boolean {
    let changed = false;
    const rate = DT_YEARS / ENGINE.internodeExpansionYears;
    for (const seg of Object.values(this.state.segments)) {
      if (seg.lengthM < seg.targetLengthM) {
        seg.lengthM = Math.min(seg.targetLengthM, seg.lengthM + seg.targetLengthM * rate);
        changed = true;
      }
    }
    return changed;
  }

  private completeElongation(year: number): void {
    const s = this.state;
    for (const gu of Object.values(s.growthUnits)) {
      if (gu.elongationComplete) continue;
      gu.elongationComplete = true;
      const axis = s.axes[gu.axisId];
      const bud = axis?.terminalBudId != null ? s.buds[axis.terminalBudId] : undefined;
      if (bud && bud.state === 'growing') {
        // El ápice persistente pasa a latente asociado al último nudo; nuevo episodio el año siguiente.
        bud.state = 'dormant';
        bud.eligibleFromYear = year + 1;
        bud.releaseEpisode += 1;
      }
    }
    for (const seg of Object.values(s.segments)) seg.lengthM = seg.targetLengthM;
  }

  // ── 4. Engrosamiento ────────────────────────────────────────────────────────────────
  private thicken(): void {
    const s = this.state;
    const { scale: sc, morphotype } = this.archetype;
    const exponent = morphotype.radiusPipeExponent;
    pipeTargetRadius([], exponent); // valida el exponente
    const cap = Math.max(0, sc.maxRadialGrowthMPerYear) * DT_YEARS;
    const all = Object.values(s.segments);
    for (let i = all.length - 1; i >= 0; i--) {
      const seg = all[i]!;
      const axis = s.axes[seg.axisId];
      if (!axis || axis.woodState !== 'living') continue;
      // Objetivo tipo pipe sobre los hijos (bucle sin arrays: se evalúa cada tick).
      let sum = 0;
      let children = 0;
      for (const c of seg.childSegmentIds) {
        const child = s.segments[c];
        if (!child) continue;
        sum += child.radiusM ** exponent;
        children++;
      }
      const pipe = children > 0 ? sum ** (1 / exponent) : sc.terminalRadiusM;
      // Demanda cambial propia de los ejes vivos, además del objetivo geométrico.
      const target = Math.max(pipe, seg.radiusM) + sc.cambialDemandMPerYear * DT_YEARS;
      // Igual que growRadius(…, actividad 1), sin validaciones en el bucle caliente.
      seg.radiusM += Math.min(Math.max(0, target - seg.radiusM), cap);
    }
  }

  // ── 5. Supervivencia ────────────────────────────────────────────────────────────────
  private evaluateSurvival(t0: number): void {
    const s = this.state;
    // Exposición media de las yemas vivas del SUBÁRBOL de cada eje: una rama madre cuyas
    // propias yemas ya no existen sigue viva mientras sus ramillas tengan follaje con luz.
    const sum = new Map<number, number>();
    const count = new Map<number, number>();
    for (const bud of Object.values(s.buds)) {
      if (bud.state === 'dead') continue;
      sum.set(bud.axisId, (sum.get(bud.axisId) ?? 0) + bud.exposure01);
      count.set(bud.axisId, (count.get(bud.axisId) ?? 0) + 1);
    }
    const axes = Object.values(s.axes).sort((a, b) => a.id - b.id);
    for (let i = axes.length - 1; i >= 0; i--) {
      const axis = axes[i]!;
      if (axis.parentAxisId === null || axis.woodState !== 'living') continue;
      const p = axis.parentAxisId;
      sum.set(p, (sum.get(p) ?? 0) + (sum.get(axis.id) ?? 0));
      count.set(p, (count.get(p) ?? 0) + (count.get(axis.id) ?? 0));
    }
    const dying: Axis[] = [];
    // Poda natural: laterales del tronco insertas en la parte baja (fuste limpio).
    const pruning = this.species.architecture.selfPruning;
    const trunkId = rootAxisId(s);
    let height = 0;
    if (pruning) for (const g of Object.values(s.segments)) height = Math.max(height, g.end[1]);
    for (const axis of axes) {
      if (axis.woodState !== 'living' || axis.parentAxisId === null) continue;
      if (pruning && axis.parentAxisId === trunkId && t0 - axis.bornAtYears > pruning.minAgeYears) {
        const carrier =
          axis.parentSegmentId !== null ? s.segments[axis.parentSegmentId] : undefined;
        const base = s.segments[axis.segmentIds[0] ?? -1];
        // Ramas temporales: las juveniles (anteriores a la pérdida del líder) y las no
        // estructurales. Las ramas madre de la copa adulta se conservan.
        const juvenile = axis.bornAtYears < this.leaderLossYear();
        const minor = !!base && !!carrier && base.radiusM < 0.4 * carrier.radiusM;
        const low = !!carrier && carrier.end[1] < pruning.belowHeightFraction * height;
        if (low && (juvenile || minor)) {
          dying.push(axis);
          continue;
        }
      }
      const n = count.get(axis.id) ?? 0;
      const mean = n > 0 ? (sum.get(axis.id) ?? 0) / n : 0;
      const deficitNow = Math.max(
        0,
        Math.min(1, (ENGINE.deficitExposure - mean) / ENGINE.deficitExposure),
      );
      axis.sustainedDeficit01 =
        (1 - ENGINE.deficitFilter) * axis.sustainedDeficit01 + ENGINE.deficitFilter * deficitNow;
      const persistence = this.frameFor(axis.role).persistence;
      const rate = ENGINE.baseMortalityPerYear * axis.sustainedDeficit01 * (1 - persistence);
      const step = advanceHazard(axis.mortality, rate, 1);
      axis.mortality = step.state;
      if (step.crossedAtFraction !== null) dying.push(axis);
    }
    if (dying.length > 0) {
      killAxes(
        s,
        dying.map((a) => a.id),
        t0,
        this.limits,
      );
      onAxesDied(this.organs, t0);
    }
    // Madera muerta retenida que se desprende (yemas y órganos se limpian en una pasada).
    const children = axisChildren(s);
    const shed = new Set<number>();
    for (const axis of axes) {
      if (
        axis.woodState === 'deadRetained' &&
        axis.diedAtYears !== null &&
        t0 - axis.diedAtYears >= ENGINE.deadWoodRetentionYears &&
        s.axes[axis.parentAxisId ?? -1]?.woodState !== 'deadRetained'
      ) {
        shedAxis(s, axis.id, t0, this.limits, children, shed);
      }
    }
    if (shed.size > 0) {
      for (const bud of Object.values(s.buds)) if (shed.has(bud.axisId)) delete s.buds[bud.id];
      removeOrphanOrgans(s);
    }
  }
}

// ── Utilidades del estado ─────────────────────────────────────────────────────────────

/** Estado inicial (una semilla). Acepta un id de especie o de arquetipo. */
export function createTreeState(speciesOrArchetypeId: string, seed: number): TreeState {
  const speciesId = speciesOrArchetypeId.includes(':')
    ? speciesOrArchetypeId
    : resolveSpeciesId({ archetypeId: speciesOrArchetypeId });
  const species = getSpecies(speciesId); // valida el id
  const s: TreeState = {
    modelVersion: MODEL_VERSION,
    speciesId,
    archetypeId: species.archetypeId,
    seed: seed >>> 0,
    stateRevision: 0,
    completedTick: 0,
    timeYears: 0,
    developmentalStage01: 0,
    nextId: 1,
    axes: {},
    growthUnits: {},
    segments: {},
    buds: {},
    leafCohorts: {},
    flowerCohorts: {},
    fruits: {},
    environment: { wind: { intensity01: 0, directionRad: 0 } },
    lastBaseExposure: 0,
    lastBudget: 0,
    capacityReached: false,
    events: [],
  };
  const azimuth = eventUniform(s.seed, 0, 0, Channel.azimuthJitter) * Math.PI * 2;
  const trunk = newAxis(s, {
    parentAxisId: null,
    parentSegmentId: null,
    role: 'trunk',
    botanicalOrder: 0,
    bornAtYears: 0,
    preferredAzimuth: [Math.cos(azimuth), 0, Math.sin(azimuth)],
  });
  const budId = s.nextId++;
  s.buds[budId] = newBud(budId, trunk.id, null, 'terminal', 0, 0, {
    azimuthRad: 0,
    positionInUnit01: 1,
  });
  trunk.terminalBudId = budId;
  return s;
}

function newAxis(
  s: TreeState,
  init: Pick<
    Axis,
    | 'parentAxisId'
    | 'parentSegmentId'
    | 'role'
    | 'botanicalOrder'
    | 'bornAtYears'
    | 'preferredAzimuth'
  >,
): Axis {
  const id = s.nextId++;
  const axis: Axis = {
    id,
    ...init,
    segmentIds: [],
    growthUnitIds: [],
    terminalBudId: null,
    phyllotaxisIndex: 0,
    metamerCount: 0,
    woodState: 'living',
    diedAtYears: null,
    sustainedDeficit01: 0,
    mortality: {
      accumulated: 0,
      threshold: thresholdFromUniform(eventUniform(s.seed, id, 0, Channel.mortalityThreshold)),
      activated: false,
    },
  };
  s.axes[id] = axis;
  return axis;
}

function newBud(
  id: number,
  axisId: number,
  segmentId: number | null,
  kind: Bud['kind'],
  bornAtYears: number,
  eligibleFromYear: number,
  placement: { azimuthRad: number; positionInUnit01: number },
): Bud {
  return {
    id,
    axisId,
    segmentId,
    kind,
    state: 'dormant',
    bornAtYears,
    eligibleFromYear,
    releaseEpisode: 0,
    azimuthRad: placement.azimuthRad,
    positionInUnit01: placement.positionInUnit01,
    heading: null,
    hazard: { accumulated: 0, threshold: Infinity, activated: false },
    activationRatePerYear: 0,
    allocated: 0,
    growthCredit: 0,
    exposure01: 1,
  };
}

/** Papel del eje nacido de una yema lateral, según el portador y el vigor del brote. */
export function childRole(parent: AxisRole, vigor01: number): AxisRole {
  switch (parent) {
    case 'trunk':
      return vigor01 >= 0.45 ? 'scaffold' : 'branch';
    case 'scaffold':
      return vigor01 >= 0.7 ? 'scaffold' : 'branch';
    case 'branch':
      return vigor01 >= 0.4 ? 'branch' : 'twig';
    case 'twig':
      return 'twig';
  }
}

function rootAxisId(s: TreeState): number {
  for (const axis of Object.values(s.axes)) if (axis.parentAxisId === null) return axis.id;
  return -1;
}

function budPosition(s: TreeState, bud: Bud): Vec3 {
  const seg = bud.segmentId !== null ? s.segments[bud.segmentId] : undefined;
  return seg ? seg.end : [0, 0, 0];
}

/**
 * Construye el campo de luz desde el estado: yemas vivas y hojas como follaje. En las
 * caducas, el follaje de la temporada anterior cuenta durante la brotación (la copa que
 * sombreó el año previo), para no tratar el árbol desnudo de invierno como luz plena.
 */
export function buildLightField(s: TreeState): LightField {
  const occluders: { position: Vec3; weight: number }[] = [];
  for (const bud of Object.values(s.buds)) {
    if (bud.state === 'dead') continue;
    if (s.axes[bud.axisId]?.woodState !== 'living') continue;
    occluders.push({ position: budPosition(s, bud), weight: 1 });
  }
  const species = getSpecies(s.speciesId);
  leafOccluders(s, species, occluders);
  return new ShadowGrid(occluders, {
    ...DEFAULT_SHADOW,
    lateralWeight: species.architecture.lateralSkyWeight,
  });
}

/** Recalcula posiciones de referencia desde la raíz (ids ascendentes). */
export function updatePositions(s: TreeState): void {
  for (const seg of Object.values(s.segments)) {
    const parent = seg.parentSegmentId !== null ? s.segments[seg.parentSegmentId] : undefined;
    seg.start = parent ? parent.end : [0, 0, 0];
    seg.end = add(seg.start, scale(seg.direction, seg.lengthM));
  }
}

function axisChildren(s: TreeState): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const a of Object.values(s.axes)) {
    if (a.parentAxisId === null) continue;
    const list = children.get(a.parentAxisId) ?? [];
    list.push(a.id);
    children.set(a.parentAxisId, list);
  }
  return children;
}

function descendantAxes(
  s: TreeState,
  rootId: number,
  children: Map<number, number[]> = axisChildren(s),
): number[] {
  const out: number[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    out.push(id);
    for (const c of children.get(id) ?? []) stack.push(c);
  }
  return out.sort((a, b) => a - b);
}

/** Muerte de varios ejes (y sus descendientes) en un único paso sobre yemas y brotes. */
function killAxes(s: TreeState, axisIds: readonly number[], t: number, limits: TreeLimits): void {
  const children = axisChildren(s);
  for (const axisId of axisIds) {
    for (const id of descendantAxes(s, axisId, children)) {
      const axis = s.axes[id]!;
      if (axis.woodState !== 'living') continue;
      axis.woodState = 'deadRetained';
      axis.diedAtYears = t;
    }
    pushEvent(s, limits, { timeYears: t, kind: 'axis-died', id: axisId });
  }
  for (const bud of Object.values(s.buds)) {
    if (s.axes[bud.axisId]?.woodState !== 'living') bud.state = 'dead';
  }
  for (const gu of Object.values(s.growthUnits)) {
    if (s.axes[gu.axisId]?.woodState !== 'living') gu.elongationComplete = true;
  }
}

/**
 * Desprendimiento: el subárbol abandona el individuo. Sus órganos se eliminan del estado
 * activo (queda el eje marcado `detached` y el evento) y se desenlazan del portador.
 * Los ejes desprendidos se añaden a `shed`: el llamador borra sus yemas en una pasada.
 */
function shedAxis(
  s: TreeState,
  axisId: number,
  t: number,
  limits: TreeLimits,
  children: Map<number, number[]>,
  shed: Set<number>,
): void {
  const ids = descendantAxes(s, axisId, children);
  for (const id of ids) {
    shed.add(id);
    const axis = s.axes[id]!;
    axis.woodState = 'detached';
    for (const segId of axis.segmentIds) delete s.segments[segId];
    for (const guId of axis.growthUnitIds) delete s.growthUnits[guId];
    axis.segmentIds = [];
    axis.growthUnitIds = [];
    axis.terminalBudId = null;
  }
  const root = s.axes[axisId];
  const carrier = root?.parentSegmentId != null ? s.segments[root.parentSegmentId] : undefined;
  if (carrier) {
    carrier.childSegmentIds = carrier.childSegmentIds.filter((c) => s.segments[c] !== undefined);
  }
  pushEvent(s, limits, { timeYears: t, kind: 'axis-shed', id: axisId });
}

function pushEvent(s: TreeState, limits: TreeLimits, event: TreeEvent): void {
  s.events.push(event);
  if (s.events.length > limits.maxEvents) s.events.splice(0, s.events.length - limits.maxEvents);
}
