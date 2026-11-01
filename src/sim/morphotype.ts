/**
 * Programas morfológicos: arquetipos NO calibrados (especificación §10).
 * Interpolar una etapa cambia los controles del crecimiento futuro; no recoloca madera
 * existente ni asigna edad real. `null` en datos físicos significa desconocido, nunca cero.
 */
import catalogJson from '../presets/archetypes.json';

export const AXIS_ROLES = ['trunk', 'scaffold', 'branch', 'twig'] as const;
export type AxisRole = (typeof AXIS_ROLES)[number];

export interface TropismWeights {
  light: number;
  targetOrientation: number;
  headingPersistence: number;
  spaceAvoidance: number;
}

export interface MorphologicalFrame {
  developmentalStage: number;
  angleAtBirthDeg: number;
  targetInclinationDeg: number;
  branchingIntensity: number;
  apicalControlLambda: number;
  persistence: number;
  tropismWeights: TropismWeights;
}

export interface RoleProgram {
  stiffnessYoungPa: number | null;
  maximumShootLengthM: number | null;
  keyframes: MorphologicalFrame[];
}

export interface Morphotype {
  id: string;
  name: string;
  status: string;
  description: string;
  radiusPipeExponent: number;
  phyllotaxis: { mode: string; divergenceDeg: number | null; note: string };
  branchingZone: {
    mode: string;
    activationBiasKnots: [number, number][];
    illustrativeCohortAzimuthDeg: number[];
  };
  roles: Record<AxisRole, RoleProgram>;
}

/**
 * Escala artística DECLARADA: valores elegidos para ver un árbol de maceta, no medidos.
 * Rellena lo que el catálogo deja a null sin convertir null en cero.
 */
export interface ArtisticScale {
  status: 'artistic-not-calibrated';
  /** Longitud de entrenudo del tronco joven (m). */
  internodeLengthM: number;
  /** Multiplicador de longitud por rol. */
  roleLengthFactor: Record<AxisRole, number>;
  /** Altura (m) a la que la longitud de entrenudo se reduce a la mitad. */
  heightHalvingM: number;
  /** Radio de un entrenudo terminal recién formado (m). */
  terminalRadiusM: number;
  /** Velocidad máxima de engrosamiento (m/año). */
  maxRadialGrowthMPerYear: number;
  /** Demanda cambial propia de ejes vivos (m/año), además del objetivo pipe. */
  cambialDemandMPerYear: number;
  /** Presupuesto por unidad de exposición en la base (unidades/año). */
  vigorAlpha: number;
  /** Coste de un metámero (unidades abstractas). */
  metamerCost: number;
  /** Máximo de metámeros en un brote anual. */
  maxMetamersPerShoot: number;
  /** Tasa base de activación de yemas laterales (1/año). */
  baseActivationRatePerYear: number;
  /**
   * Control apical local (S02): fracción en que un ápice vivo inhibe la señal de las yemas
   * laterales de su último brote. 0 = sin inhibición.
   */
  apicalInhibition: number;
  /** Años que una yema lateral latente sigue siendo viable. */
  budViabilityYears: number;
  /** Divergencia filotáctica explícita (grados): el catálogo la deja a null. */
  divergenceDeg: number;
  /** Duración artística de maduración (años) para la etapa morfológica. */
  maturityYears: number;
  /** Giro máximo por metro de crecimiento (rad/m). */
  maxTurnRadPerM: number;
  /** Amplitud de la desviación correlacionada del rumbo. */
  headingNoise: number;
}

export const DEFAULT_SCALE: ArtisticScale = {
  status: 'artistic-not-calibrated',
  internodeLengthM: 0.016,
  roleLengthFactor: { trunk: 1, scaffold: 0.9, branch: 0.75, twig: 0.55 },
  heightHalvingM: 0.3,
  terminalRadiusM: 0.0009,
  maxRadialGrowthMPerYear: 0.004,
  cambialDemandMPerYear: 0.0003,
  vigorAlpha: 6,
  metamerCost: 1,
  maxMetamersPerShoot: 7,
  baseActivationRatePerYear: 14,
  apicalInhibition: 0.3,
  budViabilityYears: 4,
  divergenceDeg: 137.5,
  maturityYears: 40,
  maxTurnRadPerM: 9,
  headingNoise: 0.18,
};

export interface Archetype {
  morphotype: Morphotype;
  scale: ArtisticScale;
}

const catalog = catalogJson as unknown as { morphotypes: Morphotype[] };

/** Ajustes de escala por arquetipo (artísticos). */
const SCALE_OVERRIDES: Record<string, Partial<ArtisticScale>> = {
  'conical-conifer': { divergenceDeg: 137.5, maxMetamersPerShoot: 6, apicalInhibition: 0.2 },
  'broad-crown-broadleaf': { divergenceDeg: 137.5, apicalInhibition: 0.05, budViabilityYears: 6 },
  'parasol-pine': { divergenceDeg: 137.5, apicalInhibition: 0.2 },
  'columnar-tree': { divergenceDeg: 137.5, maxTurnRadPerM: 6, apicalInhibition: 0.5 },
  'pendulous-tree': { divergenceDeg: 137.5, maxTurnRadPerM: 12, apicalInhibition: 0.1 },
};

export function listArchetypes(): { id: string; name: string }[] {
  return catalog.morphotypes.map((m) => ({ id: m.id, name: m.name }));
}

export function getArchetype(id: string): Archetype {
  const morphotype = catalog.morphotypes.find((m) => m.id === id);
  if (!morphotype) throw new Error(`Arquetipo desconocido: ${id}`);
  return { morphotype, scale: { ...DEFAULT_SCALE, ...(SCALE_OVERRIDES[id] ?? {}) } };
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolación por tramos entre fases ontogenéticas explícitas. */
export function evaluateRoleProgram(program: RoleProgram, stage: number): MorphologicalFrame {
  const frames = program.keyframes;
  if (frames.length < 2) throw new Error('Se necesitan al menos dos keyframes');
  const s = clamp01(stage);
  let right = frames.findIndex((f) => f.developmentalStage >= s);
  if (right <= 0) right = right === 0 ? 1 : frames.length - 1;
  const a = frames[right - 1];
  const b = frames[right];
  if (!a || !b) throw new Error('Keyframes no válidos');
  const span = b.developmentalStage - a.developmentalStage;
  const t = span > 0 ? clamp01((s - a.developmentalStage) / span) : 0;
  return {
    developmentalStage: s,
    angleAtBirthDeg: mix(a.angleAtBirthDeg, b.angleAtBirthDeg, t),
    targetInclinationDeg: mix(a.targetInclinationDeg, b.targetInclinationDeg, t),
    branchingIntensity: mix(a.branchingIntensity, b.branchingIntensity, t),
    apicalControlLambda: mix(a.apicalControlLambda, b.apicalControlLambda, t),
    persistence: mix(a.persistence, b.persistence, t),
    tropismWeights: {
      light: mix(a.tropismWeights.light, b.tropismWeights.light, t),
      targetOrientation: mix(
        a.tropismWeights.targetOrientation,
        b.tropismWeights.targetOrientation,
        t,
      ),
      headingPersistence: mix(
        a.tropismWeights.headingPersistence,
        b.tropismWeights.headingPersistence,
        t,
      ),
      spaceAvoidance: mix(a.tropismWeights.spaceAvoidance, b.tropismWeights.spaceAvoidance, t),
    },
  };
}

/** Peso relativo de activación según la posición dentro de la unidad de crecimiento. */
export function activationBias(knots: readonly [number, number][], position01: number): number {
  const x = clamp01(position01);
  if (knots.length === 0) return 1;
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1];
    const b = knots[i];
    if (a && b && x <= b[0]) {
      const span = b[0] - a[0];
      return span > 0 ? mix(a[1], b[1], (x - a[0]) / span) : b[1];
    }
  }
  return knots[knots.length - 1]?.[1] ?? 1;
}
