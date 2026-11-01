/**
 * Calendario fenológico por especie (fase 4.5), ligado al reloj biológico (no al render).
 * Fases como fracción del año (0 = 1 de enero, hemisferio norte). Las ventanas de
 * liberación, elongación y engrosamiento sustituyen a `SEASON` para cada especie.
 */
import { SEASON, inWindow } from './clock.ts';

export type Window = readonly [number, number];

export interface PhenologyCalendar {
  /** Brotación: liberación de yemas. */
  budRelease: Window;
  /** Elongación de brotes (emisión de metámeros y expansión de hojas). */
  elongation: Window;
  /** Engrosamiento cambial. */
  radialGrowth: Window;
  /** Evaluación anual de supervivencia. */
  survivalAt: number;
  /** Duración de la expansión de una hoja desde que nace (años). */
  leafExpansionYears: number;
  /** Senescencia: ventana de cambio de color (caducas) o del último año de la hoja (perennes). */
  senescence: Window;
}

export const DEFAULT_CALENDAR: PhenologyCalendar = {
  budRelease: SEASON.budRelease,
  elongation: SEASON.elongation,
  radialGrowth: SEASON.radialGrowth,
  survivalAt: SEASON.survivalAt,
  leafExpansionYears: 0.06,
  senescence: [0.74, 0.86],
};

export type Phenophase =
  | 'reposo'
  | 'floración'
  | 'brotación'
  | 'expansión foliar'
  | 'crecimiento'
  | 'senescencia'
  | 'caída de la hoja';

export interface PhenophaseInput {
  calendar: PhenologyCalendar;
  deciduous: boolean;
  bloom: Window | null;
}

/** Etiqueta legible de la fase del año para la interfaz (no interviene en el motor). */
export function phenophase(input: PhenophaseInput, phase: number): Phenophase {
  const { calendar: c, deciduous, bloom } = input;
  if (bloom && inWindow(phase, bloom)) return 'floración';
  if (inWindow(phase, c.budRelease)) return 'brotación';
  if (inWindow(phase, [c.budRelease[1], c.elongation[1]])) return 'expansión foliar';
  if (deciduous && inWindow(phase, c.senescence)) return 'senescencia';
  if (deciduous && inWindow(phase, [c.senescence[1], c.senescence[1] + 0.06])) {
    return 'caída de la hoja';
  }
  if (inWindow(phase, c.radialGrowth)) return 'crecimiento';
  return 'reposo';
}

/** Valida que las ventanas estén ordenadas y dentro del año. */
export function calendarProblems(c: PhenologyCalendar): string[] {
  const problems: string[] = [];
  const check = (name: string, w: Window): void => {
    if (!(w[0] >= 0 && w[1] <= 1 && w[0] < w[1])) problems.push(`${name} fuera de [0, 1]`);
  };
  check('budRelease', c.budRelease);
  check('elongation', c.elongation);
  check('radialGrowth', c.radialGrowth);
  check('senescence', c.senescence);
  if (c.elongation[0] < c.budRelease[0]) problems.push('la elongación empieza antes de brotar');
  if (!(c.survivalAt > c.elongation[1] && c.survivalAt < 1)) {
    problems.push('survivalAt debe ir tras la elongación');
  }
  if (!(c.leafExpansionYears > 0)) problems.push('leafExpansionYears debe ser > 0');
  return problems;
}
