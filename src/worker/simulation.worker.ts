/// <reference lib="webworker" />
/**
 * Ejecuta los ticks biológicos fuera del hilo de render (fase 2.11). El reloj biológico es
 * fijo; la velocidad solo decide cuántos ticks se procesan por segundo real.
 */
import { DT_YEARS, seasonPhase } from '../sim/clock.ts';
import { buildCycleLeaves, type LeafCycleClock, type LeafCycleMode } from '../sim/leaf-cycle.ts';
import { DETACH_KIND, DETACH_STRIDE } from '../sim/organs.ts';
import { buildRenderSnapshot } from '../sim/snapshot.ts';
import { TreeSimulation } from '../sim/tree.ts';
import type { WindSettings } from '../sim/wind.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

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

/**
 * Ciclo de hojas independiente (por defecto): las caducas muestran la estación de un
 * reloj visual propio en lugar de la del crecimiento. Ver `src/sim/leaf-cycle.ts`.
 */
let leafMode: LeafCycleMode = 'free';
let leafYearsPerSecond = 1 / 40;
const leafClock: LeafCycleClock = { phase: 0, years: 0 };
let leafTimer: ReturnType<typeof setInterval> | null = null;
let lastLeafTick = 0;

/** Con el ciclo libre, las caídas biológicas de hojas no se dibujan (las pone el ciclo). */
function visualDetachments(records: Float32Array): Float32Array {
  if (leafMode === 'coupled') return records;
  const kept: number[] = [];
  for (let o = 0; o < records.length; o += DETACH_STRIDE) {
    if (records[o] === DETACH_KIND.leaf) continue;
    const r = Array.from(records.subarray(o, o + DETACH_STRIDE));
    r[1] = leafClock.years; // al reloj de las partículas
    kept.push(...r);
  }
  return new Float32Array(kept);
}

function cycleLeaves(prevPhase: number): ReturnType<typeof buildCycleLeaves> {
  if (!sim || leafMode === 'coupled') return null;
  return buildCycleLeaves(sim.state, leafClock.phase, prevPhase, leafClock.years);
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
  const cycle = cycleLeaves(prev);
  if (!cycle) return;
  const leaves = cycle.leaves.data.slice();
  const detachments = cycle.detachments;
  post(
    {
      type: 'foliage',
      leaves: { count: cycle.leaves.count, data: leaves },
      detachments,
      clockYears: leafClock.years,
      phase: leafClock.phase,
    },
    [leaves.buffer, detachments.buffer],
  );
}

function setLeafCycle(mode: LeafCycleMode, rate: number): void {
  leafMode = mode;
  leafYearsPerSecond = Math.max(0, rate);
  const running = mode === 'free' && leafYearsPerSecond > 0;
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

function publish(): void {
  if (!sim) return;
  const built = buildRenderSnapshot(sim.state, visualDetachments(sim.drainDetachments()));
  const cycle = cycleLeaves(leafClock.phase);
  const snapshot = cycle
    ? {
        ...built,
        leaves: cycle.leaves,
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
      },
    },
    [
      segments.buffer,
      leaves.buffer,
      flowers.buffer,
      fruits.buffer,
      detachments.buffer,
      bark.positions.buffer,
      bark.normals.buffer,
      bark.colors.buffer,
      bark.indices.buffer,
    ],
  );
}

function runBatch(): void {
  if (!sim) return;
  pendingTicks += (yearsPerSecond * FRAME_MS) / 1000 / DT_YEARS;
  const start = performance.now();
  let stepped = 0;
  while (pendingTicks >= 1 && performance.now() - start < BUDGET_MS) {
    sim.step();
    pendingTicks -= 1;
    stepped++;
  }
  // Si el cálculo no da abasto, no se acumula retraso infinito.
  pendingTicks = Math.min(pendingTicks, 4);
  if (stepped > 0) publish();
}

function setPlaying(rate: number): void {
  yearsPerSecond = Math.max(0, rate);
  if (yearsPerSecond > 0 && timer === null) timer = setInterval(runBatch, FRAME_MS);
  if (yearsPerSecond === 0 && timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  try {
    const msg = event.data;
    switch (msg.type) {
      case 'reset':
        sim = new TreeSimulation({ speciesId: msg.speciesId, seed: msg.seed });
        if (wind) sim.setWind(wind);
        leafClock.phase = seasonPhase(sim.state.timeYears);
        leafClock.years = 0;
        pendingTicks = 0;
        publish();
        break;
      case 'wind':
        wind = msg.wind;
        sim?.setWind(msg.wind);
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
          // El follaje empieza en la estación a la que se ha saltado.
          leafClock.phase = seasonPhase(sim.state.timeYears);
          sim.drainDetachments();
          publish();
        }
        break;
      case 'leafCycle':
        setLeafCycle(msg.mode, msg.yearsPerSecond);
        publish();
        break;
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
