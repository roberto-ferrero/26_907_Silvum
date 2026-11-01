/**
 * Esquema de presets de especie (fase 4.1), construido sobre los arquetipos morfológicos.
 *
 * Una especie = arquetipo base + ajustes de escala artística + filotaxis explícita +
 * hoja (forma, hábito, colores, vida) + calendario fenológico + flores y frutos opcionales.
 * Nada está calibrado con datos medidos: `status` lo declara y la interfaz lo recuerda.
 */
import { SPECIES_PRESETS } from '../presets/species.ts';
import {
  AXIS_ROLES,
  getArchetype,
  listArchetypes,
  type ArtisticScale,
  type AxisRole,
  type RoleProgram,
} from './morphotype.ts';
import type { CrownEnvelopeProgram } from './envelope.ts';
import {
  DEFAULT_CALENDAR,
  calendarProblems,
  type PhenologyCalendar,
  type Window,
} from './phenology.ts';

export const LEAF_SHAPES = ['needle', 'scale', 'lobed', 'lanceolate', 'ovate'] as const;
export type LeafShape = (typeof LEAF_SHAPES)[number];
export type LeafHabit = 'deciduous' | 'evergreen';

/** Color sRGB en hexadecimal (`#rrggbb`). */
export type Hex = `#${string}`;

export interface LeafForm {
  shape: LeafShape;
  /** Longitud del limbo (m, escala artística). */
  lengthM: number;
  /** Anchura máxima / longitud. */
  widthRatio: number;
  /** Lóbulos por lado (lobulada) y profundidad relativa de los senos. */
  lobes: number;
  lobeDepth: number;
  /** Dientes del margen por lado y profundidad relativa (0 = entero). */
  teeth: number;
  toothDepth: number;
  /** Nervios secundarios por lado (solo visual). */
  veinPairs: number;
  /** Plegado en V a lo largo del nervio medio (grados). */
  foldDeg: number;
  /** Curvatura longitudinal (combado del ápice hacia abajo, adimensional). */
  curl: number;
  /** Longitud relativa del pecíolo. */
  petioleRatio: number;
}

export interface LeafColors {
  young: Hex;
  mature: Hex;
  /** Tonos de senescencia; cada hoja elige su mezcla (cambio no uniforme). */
  senescent: Hex[];
  /** Hoja muerta (seca, marcescente o caída). */
  dead: Hex;
}

export interface LeafProgram {
  form: LeafForm;
  habit: LeafHabit;
  /**
   * Hojas dibujadas por instancia unida (manojo, solo visual): más masa foliar sin más
   * estado. Las hojas que caen se dibujan sueltas.
   */
  clusterSize?: number;
  /** Unidades foliares por metámero (hojas, o haces de acículas). */
  perMetamer: number;
  /** Ángulo de inserción respecto al tallo (grados). */
  insertionDeg: number;
  /** Disposición: en el nudo (hojas), a lo largo del entrenudo, o pectinada en dos filas. */
  arrangement: 'node' | 'along' | 'pectinate';
  /**
   * Brotes cortos: en la brotación, yemas laterales latentes de madera joven abren una
   * roseta de hojas sin alargar entrenudos (braquiblastos). Probabilidad por yema a luz
   * plena y hojas por roseta. null = no hay.
   */
  shortShoots: { probability: number; leaves: number; maxBudAgeYears: number } | null;
  /** Vida de la hoja en años (perennes); 1 en caducas. */
  lifespanYears: number;
  lifespanJitter: number;
  /** Dispersión (años) de la entrada en senescencia entre hojas de una cohorte. */
  senescenceSpreadYears: number;
  /** Fracción de hojas que quedan secas en el árbol hasta la brotación (marcescencia). */
  marcescence: number;
  /** Tasa de caída de fondo por hoja (1/año): daño y renovación. */
  backgroundDropPerYear: number;
  /** Sensibilidad a las ráfagas (adimensional). */
  windFragility: number;
  /** Peso de sombra de una cohorte llena frente a una yema (1). */
  shadeWeight: number;
  /** Tendencia a tonos cálidos en las hojas más expuestas a la luz [0, 1]. */
  sunRedness: number;
  colors: LeafColors;
}

export interface FloweringProgram {
  /** Flores sobre brotes del año anterior (almendro) o sobre el brote del año (roble). */
  position: 'previousShoot' | 'currentShoot';
  /** Fase de inducción floral (brotes del año anterior). */
  inductionPhase: number;
  bloom: Window;
  /** Duración de una flor abierta (años). */
  flowerLifeYears: number;
  firstFloweringYear: number;
  /** Probabilidad de que un entrenudo elegible forme una yema floral. */
  intensity: number;
  maxPerNode: number;
  /** Pétalos (0 = flor discreta sin pétalos vistosos). */
  petals: number;
  /** Diámetro de la flor (m, artístico). */
  sizeM: number;
  colors: { bud: Hex; petal: Hex; center: Hex };
}

export interface FruitingProgram {
  kind: 'drupe' | 'acorn';
  setProbability: number;
  /** Caída fisiológica de frutos jóvenes ("caída de junio"). */
  earlyDrop: { phase: number; probability: number };
  /** Fase en la que el fruto alcanza su tamaño final (madurez). */
  ripenPhase: number;
  drop: Window;
  /** Masa fresca final (kg). Se guarda para la carga del rig (fase 5). */
  massKg: number;
  /** Longitud del fruto (m, artística). */
  sizeM: number;
  colors: { young: Hex; ripe: Hex };
}

/**
 * Arquitectura (modelo de Rauh modificado y su plasticidad): mecanismos que deciden la
 * silueta más allá de los programas de rol. `null`/vacío = sin el mecanismo.
 */
export interface ArchitectureProgram {
  /**
   * Edad (años, intervalo) en la que el líder pierde la dominancia: muere su yema terminal
   * y las laterales altas reiteran el tronco (bifurcación de los robles abiertos).
   */
  leaderLossYears: Window | null;
  /** Probabilidad anual de que una yema terminal aborte (crecimiento aparente simpodial). */
  terminalAbortion: Partial<Record<AxisRole, number>>;
  /**
   * Poda natural (sustituto hasta la luz de la fase 3): las laterales no estructurales del
   * tronco (radio < 40 % del portador) insertas por debajo de esta fracción de la altura
   * mueren al superar `minAgeYears`; así se forma el fuste limpio.
   */
  selfPruning: { belowHeightFraction: number; minAgeYears: number } | null;
  /**
   * Peso del cielo lateral en la luz provisional (0 = solo sombra desde arriba). Necesario
   * para árboles de luz aislados con ramas bajas vivas; la fase 3 lo hará general.
   */
  lateralSkyWeight: number;
  /** Ramas madre que arman la copa al perder el líder (intervalo, por semilla) o null. */
  forkLimbs: readonly [number, number] | null;
  /** Entrenudos vivos a los que tiende el árbol adulto (saturación artística) o null. */
  woodTargetSegments: number | null;
  /** Fracción anual de la combadura por peso que pasa a la forma (memoria lenta, 5.6). */
  shapeMemoryPerYear: number;
}

export const NO_ARCHITECTURE: ArchitectureProgram = {
  leaderLossYears: null,
  terminalAbortion: {},
  selfPruning: null,
  lateralSkyWeight: 0,
  forkLimbs: null,
  woodTargetSegments: null,
  shapeMemoryPerYear: 0,
};

export interface SpeciesPreset {
  id: string;
  name: string;
  taxon: string;
  status: 'illustrative-not-calibrated';
  description: string;
  archetypeId: string;
  /** Ajustes de la escala artística del arquetipo. */
  scale: Partial<ArtisticScale>;
  /** Filotaxis explícita (el catálogo deja la divergencia a null). */
  phyllotaxis: { mode: 'spiral' | 'distichous' | 'opposite'; divergenceDeg: number };
  /** Ajustes morfológicos sobre los programas de rol del arquetipo. */
  morphology: {
    inclinationOffsetDeg: Partial<Record<AxisRole, number>>;
    branchingFactor: number;
    /** Programas de rol propios de la especie (sustituyen a los del arquetipo). */
    roles?: Partial<Record<AxisRole, RoleProgram>>;
    /**
     * Grados que se suman a la inclinación objetivo de las ramas según lo baja que esté su
     * punta en el árbol (0 en la cima, todo en la base): copa en cúpula, ramas bajas abiertas.
     */
    lowerCrownSpreadDeg: number;
    /** Exponente de la regla de tuberías (mayor = troncos y ramas madre más finos). */
    radiusPipeExponent?: number;
    /** Sesgo de activación por posición en la unidad de crecimiento (acrotonía). */
    activationBiasKnots?: [number, number][];
  };
  architecture: ArchitectureProgram;
  /** Silueta artística a la que se guía la copa (null = sin guía). */
  crownEnvelope: CrownEnvelopeProgram | null;
  phenology: PhenologyCalendar;
  leaves: LeafProgram;
  flowering: FloweringProgram | null;
  fruiting: FruitingProgram | null;
}

/** Especie resuelta: preset + escala final del arquetipo. */
export interface Species extends SpeciesPreset {
  resolvedScale: ArtisticScale;
}

const GENERIC_PREFIX = 'archetype:';

const GENERIC_BROADLEAF: LeafProgram = {
  form: {
    shape: 'ovate',
    lengthM: 0.026,
    widthRatio: 0.55,
    lobes: 0,
    lobeDepth: 0,
    teeth: 0,
    toothDepth: 0,
    veinPairs: 5,
    foldDeg: 14,
    curl: 0.15,
    petioleRatio: 0.15,
  },
  habit: 'deciduous',
  perMetamer: 1,
  insertionDeg: 50,
  arrangement: 'node',
  shortShoots: null,
  lifespanYears: 1,
  lifespanJitter: 0,
  senescenceSpreadYears: 0.05,
  marcescence: 0,
  backgroundDropPerYear: 0.12,
  windFragility: 1,
  shadeWeight: 0.25,
  sunRedness: 0.2,
  colors: {
    young: '#a9c46a',
    mature: '#55763a',
    senescent: ['#c9b142', '#c27d34'],
    dead: '#86643c',
  },
};

const GENERIC_NEEDLE: LeafProgram = {
  ...GENERIC_BROADLEAF,
  form: {
    ...GENERIC_BROADLEAF.form,
    shape: 'needle',
    lengthM: 0.012,
    widthRatio: 0.1,
    veinPairs: 0,
    foldDeg: 0,
    curl: 0.1,
    petioleRatio: 0,
  },
  habit: 'evergreen',
  perMetamer: 2,
  insertionDeg: 55,
  arrangement: 'along',
  lifespanYears: 4,
  lifespanJitter: 0.25,
  senescenceSpreadYears: 0.4,
  backgroundDropPerYear: 0.03,
  windFragility: 0.3,
  shadeWeight: 0.25,
  sunRedness: 0,
  colors: {
    young: '#93b856',
    mature: '#355a2e',
    senescent: ['#b7a14a', '#a57a3c'],
    dead: '#7c5a35',
  },
};

/** Especie genérica para un arquetipo sin especie: conserva el calendario de la fase 2. */
function genericSpecies(archetypeId: string): SpeciesPreset {
  const archetype = getArchetype(archetypeId);
  const conifer = archetypeId === 'conical-conifer' || archetypeId === 'parasol-pine';
  return {
    id: GENERIC_PREFIX + archetypeId,
    name: archetype.morphotype.name,
    taxon: '—',
    status: 'illustrative-not-calibrated',
    description: 'Arquetipo sin especie: hoja genérica y calendario por defecto.',
    archetypeId,
    scale: {},
    phyllotaxis: { mode: 'spiral', divergenceDeg: archetype.scale.divergenceDeg },
    morphology: { inclinationOffsetDeg: {}, branchingFactor: 1, lowerCrownSpreadDeg: 0 },
    architecture: NO_ARCHITECTURE,
    crownEnvelope: null,
    phenology: DEFAULT_CALENDAR,
    leaves: conifer ? GENERIC_NEEDLE : GENERIC_BROADLEAF,
    flowering: null,
    fruiting: null,
  };
}

export function listSpecies(): { id: string; name: string; taxon: string }[] {
  return SPECIES_PRESETS.map((p) => ({ id: p.id, name: p.name, taxon: p.taxon }));
}

export function isSpeciesId(id: string): boolean {
  return SPECIES_PRESETS.some((p) => p.id === id);
}

/** Id de especie para un arquetipo sin especie (depuración con `?archetype=`). */
export function genericSpeciesId(archetypeId: string): string {
  return GENERIC_PREFIX + archetypeId;
}

const cache = new Map<string, Species>();

/** Resuelve una especie por id, o la especie genérica de un arquetipo (`archetype:<id>` o el id del arquetipo). */
export function getSpecies(id: string): Species {
  const hit = cache.get(id);
  if (hit) return hit;
  let preset = SPECIES_PRESETS.find((p) => p.id === id);
  if (!preset) {
    const archetypeId = id.startsWith(GENERIC_PREFIX) ? id.slice(GENERIC_PREFIX.length) : id;
    if (!listArchetypes().some((a) => a.id === archetypeId)) {
      throw new Error(`Especie desconocida: ${id}`);
    }
    preset = genericSpecies(archetypeId);
  }
  const base = getArchetype(preset.archetypeId).scale;
  const species: Species = {
    ...preset,
    resolvedScale: { ...base, ...preset.scale, divergenceDeg: preset.phyllotaxis.divergenceDeg },
  };
  cache.set(id, species);
  return species;
}

/** Comprobaciones del esquema: devuelve los problemas encontrados (vacío = válido). */
export function speciesProblems(p: SpeciesPreset): string[] {
  const out: string[] = [];
  if (p.status !== 'illustrative-not-calibrated') out.push('status debe declarar no calibrado');
  if (!listArchetypes().some((a) => a.id === p.archetypeId)) out.push('arquetipo inexistente');
  if (!(Number.isFinite(p.phyllotaxis.divergenceDeg) && p.phyllotaxis.divergenceDeg > 0)) {
    out.push('divergencia filotáctica no explícita');
  }
  for (const role of Object.keys(p.morphology.inclinationOffsetDeg)) {
    if (!(AXIS_ROLES as readonly string[]).includes(role)) out.push(`rol desconocido: ${role}`);
  }
  for (const [role, program] of Object.entries(p.morphology.roles ?? {})) {
    if (!(AXIS_ROLES as readonly string[]).includes(role)) out.push(`rol desconocido: ${role}`);
    if (!program || program.keyframes.length < 2) out.push(`${role}: faltan keyframes`);
  }
  const a = p.architecture;
  if (
    a.leaderLossYears &&
    !(a.leaderLossYears[0] > 0 && a.leaderLossYears[0] <= a.leaderLossYears[1])
  ) {
    out.push('leaderLossYears no válido');
  }
  for (const v of Object.values(a.terminalAbortion)) {
    if (!(v >= 0 && v < 1)) out.push('terminalAbortion en [0, 1)');
  }
  if (
    a.selfPruning &&
    !(a.selfPruning.belowHeightFraction > 0 && a.selfPruning.belowHeightFraction < 0.6)
  ) {
    out.push('selfPruning.belowHeightFraction en (0, 0.6)');
  }
  out.push(...calendarProblems(p.phenology));
  const l = p.leaves;
  if (!LEAF_SHAPES.includes(l.form.shape)) out.push('forma de hoja desconocida');
  if (!(l.form.lengthM > 0 && l.form.widthRatio > 0)) out.push('tamaño de hoja no válido');
  if (!(l.perMetamer >= 1 && l.perMetamer <= 30 && Number.isInteger(l.perMetamer))) {
    out.push('perMetamer debe ser un entero en [1, 30]');
  }
  if (l.habit === 'deciduous' && l.lifespanYears !== 1) out.push('una caduca vive un año');
  if (l.habit === 'evergreen' && !(l.lifespanYears > 1)) out.push('una perenne vive > 1 año');
  if (l.habit === 'evergreen' && l.marcescence > 0) out.push('marcescencia solo en caducas');
  if (l.shortShoots && !(l.shortShoots.leaves >= 1 && l.shortShoots.leaves <= 30)) {
    out.push('hojas por roseta en [1, 30]');
  }
  if (l.colors.senescent.length === 0) out.push('faltan tonos de senescencia');
  const hex = /^#[0-9a-f]{6}$/i;
  const colors = [l.colors.young, l.colors.mature, l.colors.dead, ...l.colors.senescent];
  if (p.flowering) colors.push(...Object.values(p.flowering.colors));
  if (p.fruiting) colors.push(...Object.values(p.fruiting.colors));
  for (const c of colors) if (!hex.test(c)) out.push(`color no válido: ${c}`);
  if (p.fruiting && !p.flowering) out.push('un fruto necesita flores');
  if (p.flowering && p.flowering.maxPerNode > 4) out.push('maxPerNode ≤ 4');
  if (p.fruiting && !(p.fruiting.massKg > 0)) out.push('masa del fruto no válida');
  return out;
}
