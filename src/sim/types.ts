import type { AxisRole } from './morphotype.ts';
import type { HazardState } from './allocation.ts';
import type { Vec3 } from './vec3.ts';
import type { UserLight } from './light.ts';
import type { WindSettings } from './wind.ts';

/**
 * Estado botánico persistente (especificación §2). La geometría visible se deriva de él.
 * Unidades: metros, años, radianes; +Y arriba. Todo es serializable (structuredClone).
 * El papel de un eje (`role`) y su orden botánico son independientes.
 */
export type BudKind = 'terminal' | 'lateral';
export type BudState = 'dormant' | 'growing' | 'dead';
export type WoodState = 'living' | 'deadRetained' | 'detached';

export interface Axis {
  id: number;
  parentAxisId: number | null;
  /** Entrenudo portador en el eje padre (null en el tronco). */
  parentSegmentId: number | null;
  role: AxisRole;
  botanicalOrder: number;
  bornAtYears: number;
  segmentIds: number[];
  growthUnitIds: number[];
  terminalBudId: number | null;
  /** Azimut persistente de la rama (horizontal), usado cerca de la vertical. */
  preferredAzimuth: Vec3;
  /** Contador filotáctico: cuántas yemas laterales ha colocado el eje. */
  phyllotaxisIndex: number;
  /** Metámeros producidos por el eje (para el ruido correlacionado del rumbo). */
  metamerCount: number;
  woodState: WoodState;
  diedAtYears: number | null;
  /** Déficit sostenido filtrado en [0, 1]. */
  sustainedDeficit01: number;
  /** Umbral persistente para la mortalidad por déficit. */
  mortality: HazardState;
  /** Rama madre que releva al líder en vertical (cierra la cima de la copa). */
  uprightRelay?: boolean;
  /** Combadura por peso ya incorporada a la forma (rad, memoria lenta 5.6). */
  sagMemoryRad?: number;
}

/** Un episodio continuo de extensión (un brote anual). */
export interface GrowthUnit {
  id: number;
  axisId: number;
  year: number;
  startedAtYears: number;
  plannedMetamers: number;
  emittedMetamers: number;
  segmentIds: number[];
  elongationComplete: boolean;
}

/** Entrenudo biológico. Una subdivisión de dibujo nunca crea otro. */
export interface Segment {
  id: number;
  axisId: number;
  growthUnitId: number;
  /** Índice dentro de su unidad de crecimiento (0 = base). */
  metamerIndex: number;
  parentSegmentId: number | null;
  childSegmentIds: number[];
  bornAtYears: number;
  /** Dirección de referencia (unitaria). */
  direction: Vec3;
  /** Normal material transportada (unitaria, perpendicular a `direction`). */
  frameU: Vec3;
  lengthM: number;
  targetLengthM: number;
  /** Radio en la base del entrenudo. Monotónico mientras no se desprenda. */
  radiusM: number;
  /** Posiciones de referencia derivadas (se recalculan desde la raíz). */
  start: Vec3;
  end: Vec3;
}

export interface Bud {
  id: number;
  axisId: number;
  /** Entrenudo en cuyo extremo distal está la yema. */
  segmentId: number | null;
  kind: BudKind;
  state: BudState;
  bornAtYears: number;
  /** Año a partir del cual puede liberarse. */
  eligibleFromYear: number;
  releaseEpisode: number;
  /** Colocación fija al nacer, en el marco del eje portador. */
  azimuthRad: number;
  /** Posición relativa dentro de su unidad de crecimiento (0 base, 1 extremo). */
  positionInUnit01: number;
  /** Rumbo del próximo entrenudo (null: continuar el del entrenudo portador). */
  heading: Vec3 | null;
  hazard: HazardState;
  /** Tasa de activación fijada al inicio de la liberación (1/año). */
  activationRatePerYear: number;
  /** Presupuesto asignado este año (unidades abstractas). */
  allocated: number;
  growthCredit: number;
  exposure01: number;
}

/**
 * Cohorte de hojas de un entrenudo (fase 4.6.3). Las hojas individuales no se guardan:
 * sus rasgos (desfase, velocidad de senescencia, tamaño, giro) se derivan de
 * (semilla, cohorte, índice), y solo persiste qué hojas siguen unidas.
 */
export interface LeafCohort {
  id: number;
  segmentId: number;
  axisId: number;
  bornAtYears: number;
  /** Hojas (o haces de acículas) al formarse; ≤ 30. */
  count: number;
  /** Bit i = la hoja i sigue unida. */
  attachedMask: number;
  /** Azimut de la primera hoja (el de la yema axilar del nudo). */
  baseAzimuthRad: number;
  /** Luz recibida al formarse (perennes: se renueva cada brotación). */
  exposure01: number;
  health01: number;
  /** Inicio propio de la senescencia (años absolutos). */
  senescenceAtYears: number;
  /** Duración de la transición de color (años). */
  senescenceSpanYears: number;
  /** El eje murió: las hojas se secan sin seguir la fenología. */
  withered: boolean;
  /** Caídas de fondo ocurridas (índice del siguiente evento aleatorio). */
  backgroundDrops: number;
  nextBackgroundDropYears: number;
}

/** Cohorte de flores de un nudo (fase 4.7). Cada flor abre y se deshoja en su fecha. */
export interface FlowerCohort {
  id: number;
  segmentId: number;
  axisId: number;
  initiatedAtYears: number;
  bloomYear: number;
  count: number;
  /** Apertura de la primera flor (años absolutos). */
  openAtYears: number;
  exposure01: number;
  /** Bit i = la flor i ya perdió los pétalos (y se decidió su cuajado). */
  shedMask: number;
  done: boolean;
}

/** Fruto (fase 4.8). Su masa se guarda como carga para el rig (fase 5). */
export interface FruitState {
  id: number;
  segmentId: number;
  axisId: number;
  flowerCohortId: number;
  /** Índice de la flor de origen en su cohorte. */
  index: number;
  setAtYears: number;
  /** Progreso de crecimiento [0, 1]. */
  growth01: number;
  massKg: number;
  ripe: boolean;
  /** Fecha prevista de caída (años absolutos). */
  dropAtYears: number;
  /** Caída fisiológica temprana (fruto joven). */
  earlyDrop: boolean;
}

/** Entorno controlable. Cambiarlo es un evento en el instante actual. */
export interface Environment {
  wind: WindSettings;
  light: UserLight;
}

export interface TreeEvent {
  timeYears: number;
  kind:
    | 'bud-activated'
    | 'axis-born'
    | 'axis-died'
    | 'axis-shed'
    | 'capacity-reached'
    | 'environment-changed'
    | 'leader-lost';
  id: number;
  detail?: string;
}

export interface TreeState {
  modelVersion: string;
  /** Especie (preset) o especie genérica de un arquetipo (`archetype:<id>`). */
  speciesId: string;
  archetypeId: string;
  seed: number;
  stateRevision: number;
  completedTick: number;
  timeYears: number;
  developmentalStage01: number;
  nextId: number;
  axes: Record<number, Axis>;
  growthUnits: Record<number, GrowthUnit>;
  segments: Record<number, Segment>;
  buds: Record<number, Bud>;
  leafCohorts: Record<number, LeafCohort>;
  flowerCohorts: Record<number, FlowerCohort>;
  fruits: Record<number, FruitState>;
  environment: Environment;
  /** Última exposición total en la base (Q_base) y presupuesto anual. */
  lastBaseExposure: number;
  lastBudget: number;
  capacityReached: boolean;
  events: TreeEvent[];
}

export interface TreeLimits {
  maxSegments: number;
  maxBuds: number;
  maxEvents: number;
}

export const DEFAULT_LIMITS: TreeLimits = { maxSegments: 60000, maxBuds: 60000, maxEvents: 2000 };
