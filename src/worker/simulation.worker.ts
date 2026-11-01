/// <reference lib="webworker" />
/**
 * Ejecuta los ticks biológicos fuera del hilo de render (fase 2.11). El reloj biológico es
 * fijo; la velocidad solo decide cuántos ticks se procesan por segundo real.
 */
import { DT_YEARS } from '../sim/clock.ts';
import { buildRenderSnapshot } from '../sim/snapshot.ts';
import { TreeSimulation } from '../sim/tree.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

const FRAME_MS = 50;
/** Tiempo máximo de cálculo por lote para no bloquear la publicación. */
const BUDGET_MS = 40;

let sim: TreeSimulation | null = null;
let yearsPerSecond = 0;
let pendingTicks = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function post(message: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer);
}

function publish(): void {
  if (!sim) return;
  const snapshot = buildRenderSnapshot(sim.state);
  const copy = snapshot.segments.slice();
  post({ type: 'snapshot', snapshot: { ...snapshot, segments: copy } }, [copy.buffer]);
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
        sim = new TreeSimulation({ archetypeId: msg.archetypeId, seed: msg.seed });
        pendingTicks = 0;
        publish();
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
          publish();
        }
        break;
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
