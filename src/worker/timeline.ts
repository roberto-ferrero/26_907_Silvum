/**
 * Línea de tiempo del Worker (fases 7.2-7.3): instantáneas del estado cada pocos años,
 * comprimidas, y un precálculo en segundo plano que va llenándolas hasta el final de la
 * línea de tiempo. Saltar a un año (adelante o atrás) es restaurar la instantánea previa
 * más cercana y avanzar el resto, en lugar de simular desde la semilla.
 *
 * Los cambios del entorno (viento) son eventos: invalidan las instantáneas posteriores y
 * el precálculo vuelve a empezar desde el instante del cambio.
 */
import { DT_YEARS } from '../sim/clock.ts';
import { TreeSimulation } from '../sim/tree.ts';
import type { TreeState } from '../sim/types.ts';

/** Años entre instantáneas. */
export const CHECKPOINT_EVERY_YEARS = 3;
/** Tiempo máximo de cada porción de precálculo (ms) para no bloquear el Worker. */
const SLICE_MS = 25;

const INF = '__inf__';
const NEG_INF = '__-inf__';

/** JSON con Infinity (umbrales de hazard y esperas sin evento). */
export function serializeState(state: TreeState): string {
  return JSON.stringify(state, (_k, v: unknown) =>
    v === Infinity ? INF : v === -Infinity ? NEG_INF : v,
  );
}

export function deserializeState(json: string): TreeState {
  return JSON.parse(json, (_k, v: unknown) =>
    v === INF ? Infinity : v === NEG_INF ? -Infinity : v,
  ) as TreeState;
}

async function compress(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function decompress(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export class Timeline {
  private checkpoints = new Map<number, Promise<ArrayBuffer>>();
  private ahead: TreeSimulation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private paused = false;

  constructor(
    private readonly maxYears: number,
    private readonly onProgress: (years: number) => void,
  ) {}

  /** Nuevo árbol: borra todo y precalcula desde su estado inicial. */
  reset(state: TreeState): void {
    this.checkpoints.clear();
    this.restartFrom(state);
  }

  /** El entorno cambió en `state.timeYears`: lo posterior ya no vale. */
  invalidateAfter(state: TreeState): void {
    for (const year of [...this.checkpoints.keys()]) {
      if (year > state.timeYears + 1e-9) this.checkpoints.delete(year);
    }
    this.restartFrom(state);
  }

  /** Guarda una instantánea si el estado está justo en un año de instantánea. */
  record(state: TreeState): void {
    const year = Math.round(state.timeYears);
    if (Math.abs(state.timeYears - year) > DT_YEARS / 2) return;
    if (year % CHECKPOINT_EVERY_YEARS !== 0 || this.checkpoints.has(year)) return;
    this.checkpoints.set(year, compress(serializeState(state)));
  }

  /** Año de la instantánea más reciente que no pasa de `years`, o null. */
  nearest(years: number): number | null {
    let best: number | null = null;
    for (const year of this.checkpoints.keys()) {
      if (year <= years + 1e-9 && (best === null || year > best)) best = year;
    }
    return best;
  }

  async restore(year: number): Promise<TreeState> {
    const data = this.checkpoints.get(year);
    if (!data) throw new Error(`No hay instantánea del año ${year}`);
    return deserializeState(await decompress(await data));
  }

  /** Detiene el precálculo mientras se atiende un salto (comparten el hilo). */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.schedule();
  }

  /** Hasta dónde llegan las instantáneas seguidas desde el año 0. */
  get coveredYears(): number {
    let y = 0;
    while (this.checkpoints.has(y + CHECKPOINT_EVERY_YEARS)) y += CHECKPOINT_EVERY_YEARS;
    return this.checkpoints.has(0) ? y : 0;
  }

  private restartFrom(state: TreeState): void {
    this.ahead = new TreeSimulation({ state: structuredClone(state) });
    this.record(this.ahead.state);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null || this.paused || !this.ahead) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.slice();
    }, 0);
  }

  private slice(): void {
    const sim = this.ahead;
    if (!sim || this.paused) return;
    const start = performance.now();
    while (performance.now() - start < SLICE_MS && sim.state.timeYears < this.maxYears) {
      sim.step();
      sim.drainDetachments();
      this.record(sim.state);
    }
    this.onProgress(this.coveredYears);
    if (sim.state.timeYears < this.maxYears) this.schedule();
    else this.ahead = null;
  }
}
