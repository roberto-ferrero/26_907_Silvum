/// <reference lib="webworker" />
/**
 * Ejecuta los ticks biológicos fuera del hilo de render (fase 2.11). El reloj biológico es
 * fijo; la velocidad solo decide cuántos ticks se procesan por segundo real.
 */
import { DT_YEARS } from '../sim/clock.ts';
import {
  buildCycleFlowers,
  buildCycleLeaves,
  type LeafCycleClock,
  type LeafCycleMode,
} from '../sim/leaf-cycle.ts';
import type { OrganBuffers } from '../sim/snapshot.ts';
import { DETACH_KIND, DETACH_STRIDE } from '../sim/organs.ts';
import { buildRenderSnapshot } from '../sim/snapshot.ts';
import { TreeSimulation } from '../sim/tree.ts';
import type { UserLight } from '../sim/light.ts';
import type { WindSettings } from '../sim/wind.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import { Timeline } from './timeline.ts';

/** Extremo de la línea de tiempo (años), el mismo que muestra el panel. */
const TIMELINE_MAX_YEARS = 80;

declare const self: DedicatedWorkerGlobalScope;

const FRAME_MS = 50;
/** Tiempo máximo de cálculo por lote para no bloquear la publicación. */
const BUDGET_MS = 40;

let sim: TreeSimulation | null = null;
let yearsPerSecond = 0;
let pendingTicks = 0;
let timer: ReturnType<typeof setInterval> | null = null;
/** Viento vigente: se conserva al reiniciar el árbol. */
let wind: WindSettings | null = null;
/** Luz vigente: también se conserva al reiniciar. */
let light: UserLight | null = null;

/**
 * Ciclo de hojas independiente (por defecto): las caducas muestran la estación de un
 * reloj visual propio en lugar de la del crecimiento. Ver `src/sim/leaf-cycle.ts`.
 */
let leafMode: LeafCycleMode = 'free';
let leafYearsPerSecond = 1 / 40;
let leafPlaying = false;
/** Arranca en primavera, con el ciclo en pausa (el panel puede cambiarlo). */
const leafClock: LeafCycleClock = { phase: 0.4, years: 0 };
let leafTimer: ReturnType<typeof setInterval> | null = null;
let lastLeafTick = 0;

const timeline = new Timeline(TIMELINE_MAX_YEARS, (years) => post({ type: 'cache', years }));

/** Con el ciclo libre, las caídas biológicas de hojas no se dibujan (las pone el ciclo). */
function visualDetachments(records: Float32Array): Float32Array {
  if (leafMode === 'coupled') return records;
  const kept: number[] = [];
  for (let o = 0; o < records.length; o += DETACH_STRIDE) {
    if (records[o] === DETACH_KIND.leaf || records[o] === DETACH_KIND.petal) continue;
    const r = Array.from(records.subarray(o, o + DETACH_STRIDE));
    r[1] = leafClock.years; // al reloj de las partículas
    kept.push(...r);
  }
  return new Float32Array(kept);
}

/** Hojas y flores del ciclo visual, con sus caídas (null si no aplica). */
function cycleLeaves(prevPhase: number): {
  leaves: OrganBuffers;
  flowers: OrganBuffers;
  detachments: Float32Array;
} | null {
  if (!sim || leafMode === 'coupled') return null;
  const leaves = buildCycleLeaves(sim.state, leafClock.phase, prevPhase, leafClock.years);
  if (!leaves) return null;
  const flowers = buildCycleFlowers(sim.state, leafClock.phase, prevPhase, leafClock.years);
  const detachments = new Float32Array(leaves.detachments.length + flowers.detachments.length);
  detachments.set(leaves.detachments);
  detachments.set(flowers.detachments, leaves.detachments.length);
  return { leaves: leaves.leaves, flowers: flowers.flowers, detachments };
}

function leafTick(): void {
  if (!sim) return;
  const now = performance.now();
  const dt = Math.min(0.25, (now - lastLeafTick) / 1000);
  lastLeafTick = now;
  const prev = leafClock.phase;
  const advance = leafYearsPerSecond * dt;
  leafClock.phase = (leafClock.phase + advance) % 1;
  leafClock.years += advance;
  publishFoliage(prev);
}

/** Publica hojas y flores del ciclo visual (y las caídas desde `prev`). */
function publishFoliage(prev: number): void {
  const cycle = cycleLeaves(prev);
  if (!cycle) return;
  const leaves = cycle.leaves.data.slice();
  const flowers = cycle.flowers.data.slice();
  const detachments = cycle.detachments;
  post(
    {
      type: 'foliage',
      leaves: { count: cycle.leaves.count, data: leaves },
      flowers: { count: cycle.flowers.count, data: flowers },
      detachments,
      clockYears: leafClock.years,
      phase: leafClock.phase,
    },
    [leaves.buffer, flowers.buffer, detachments.buffer],
  );
}

function setLeafCycle(mode: LeafCycleMode, rate: number, playing: boolean): void {
  leafMode = mode;
  leafYearsPerSecond = Math.max(0, rate);
  leafPlaying = playing;
  const running = mode === 'free' && leafPlaying && leafYearsPerSecond > 0;
  if (running && leafTimer === null) {
    lastLeafTick = performance.now();
    leafTimer = setInterval(leafTick, FRAME_MS);
  }
  if (!running && leafTimer !== null) {
    clearInterval(leafTimer);
    leafTimer = null;
  }
}

function post(message: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

/** Coste medio (media móvil exponencial, ms) por tick y por publicación (fase 9.2). */
const perf = { tickMs: 0, publishMs: 0, lastReport: 0 };
const ema = (old: number, value: number): number => (old === 0 ? value : old * 0.9 + value * 0.1);

function measureTicks(ms: number, ticks: number): void {
  if (ticks > 0) perf.tickMs = ema(perf.tickMs, ms / ticks);
  const now = performance.now();
  if (now - perf.lastReport > 1000) {
    perf.lastReport = now;
    post({ type: 'perf', tickMs: perf.tickMs, publishMs: perf.publishMs });
  }
}

function publish(): void {
  if (!sim) return;
  const publishStart = performance.now();
  const built = buildRenderSnapshot(sim.state, visualDetachments(sim.drainDetachments()));
  const cycle = cycleLeaves(leafClock.phase);
  const snapshot = cycle
    ? {
        ...built,
        leaves: cycle.leaves,
        flowers: cycle.flowers,
        clockYears: leafClock.years,
        foliagePhase: leafClock.phase,
      }
    : built;
  // Copias compactas que se transfieren sin duplicar memoria.
  const segments = snapshot.segments.slice();
  const leaves = snapshot.leaves.data.slice();
  const flowers = snapshot.flowers.data.slice();
  const fruits = snapshot.fruits.data.slice();
  const detachments = snapshot.detachments.slice();
  const budLight = snapshot.budLight.slice();
  const { bark } = snapshot;
  post(
    {
      type: 'snapshot',
      snapshot: {
        ...snapshot,
        segments,
        leaves: { count: snapshot.leaves.count, data: leaves },
        flowers: { count: snapshot.flowers.count, data: flowers },
        fruits: { count: snapshot.fruits.count, data: fruits },
        detachments,
        budLight,
      },
    },
    [
      budLight.buffer,
      segments.buffer,
      leaves.buffer,
      flowers.buffer,
      fruits.buffer,
      detachments.buffer,
      bark.positions.buffer,
      bark.normals.buffer,
      bark.colors.buffer,
      bark.barkUv.buffer,
      bark.barkAge.buffer,
      bark.indices.buffer,
    ],
  );
  perf.publishMs = ema(perf.publishMs, performance.now() - publishStart);
}

function runBatch(): void {
  if (!sim) return;
  pendingTicks += (yearsPerSecond * FRAME_MS) / 1000 / DT_YEARS;
  const start = performance.now();
  let stepped = 0;
  while (pendingTicks >= 1 && performance.now() - start < BUDGET_MS) {
    sim.step();
    timeline.record(sim.state);
    pendingTicks -= 1;
    stepped++;
  }
  measureTicks(performance.now() - start, stepped);
  // Si el cálculo no da abasto, no se acumula retraso infinito.
  pendingTicks = Math.min(pendingTicks, 4);
  // Publicación adaptativa: con árboles grandes una instantánea cuesta ~100 ms, así que
  // no se publica más a menudo que el doble de lo que cuesta (el crecimiento no espera).
  const now = performance.now();
  if (stepped > 0 && now - lastPublish >= Math.max(FRAME_MS, 2 * perf.publishMs)) {
    lastPublish = now;
    publish();
  }
}

let lastPublish = 0;

function setPlaying(rate: number): void {
  yearsPerSecond = Math.max(0, rate);
  if (yearsPerSecond > 0 && timer === null) timer = setInterval(runBatch, FRAME_MS);
  if (yearsPerSecond === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Salto a `years`: desde la instantánea más cercana anterior (o desde el estado actual si
 * está más cerca y el salto es hacia delante), avanzando el resto.
 */
async function seek(years: number): Promise<void> {
  if (!sim) return;
  const target = Math.max(0, Math.min(TIMELINE_MAX_YEARS, years));
  const current = sim.state.timeYears;
  if (Math.abs(target - current) < DT_YEARS / 2) return publish();
  timeline.pause();
  post({ type: 'busy', busy: true });
  try {
    const checkpoint = timeline.nearest(target);
    const fromCurrent = target >= current && (checkpoint === null || current >= checkpoint);
    if (!fromCurrent && checkpoint !== null) {
      sim = new TreeSimulation({ state: await timeline.restore(checkpoint) });
    }
    const ticks = Math.round((target - sim.state.timeYears) / DT_YEARS);
    const stepStart = performance.now();
    for (let i = 0; i < ticks; i++) {
      sim.step();
      timeline.record(sim.state);
    }
    measureTicks(performance.now() - stepStart, ticks);
    sim.drainDetachments();
    publish();
  } finally {
    post({ type: 'busy', busy: false });
    timeline.resume();
  }
}

/** Los mensajes se atienden en orden, también los asíncronos (saltos). */
let queue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<ToWorker>) => {
  queue = queue
    .then(() => handle(event.data))
    .catch((error: unknown) => {
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    });
};

async function handle(msg: ToWorker): Promise<void> {
  {
    switch (msg.type) {
      case 'reset':
        sim = new TreeSimulation({ speciesId: msg.speciesId, seed: msg.seed });
        if (wind) sim.setWind(wind);
        if (light) sim.setLight(light);
        leafClock.years = 0;
        pendingTicks = 0;
        timeline.reset(sim.state);
        publish();
        break;
      case 'wind':
        wind = msg.wind;
        if (sim) {
          sim.setWind(msg.wind);
          timeline.invalidateAfter(sim.state);
          // La vista toma el viento de la instantánea: también con el crecimiento en pausa.
          publish();
        }
        break;
      case 'light':
        light = msg.light;
        if (sim) {
          sim.setLight(msg.light);
          timeline.invalidateAfter(sim.state);
        }
        break;
      case 'seek':
        await seek(msg.years);
        break;
      case 'play':
        setPlaying(msg.yearsPerSecond);
        break;
      case 'pause':
        setPlaying(0);
        break;
      case 'advance':
        if (sim) {
          sim.advanceYears(msg.years);
          sim.drainDetachments();
          publish();
        }
        break;
      case 'leafCycle':
        setLeafCycle(msg.mode, msg.yearsPerSecond, msg.playing);
        publish();
        break;
      case 'leafPhase':
        leafClock.phase = ((msg.phase % 1) + 1) % 1;
        publishFoliage(leafClock.phase);
        break;
    }
  }
}
