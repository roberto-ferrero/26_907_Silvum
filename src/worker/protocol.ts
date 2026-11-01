import type { RenderSnapshot } from '../sim/snapshot.ts';

/** Mensajes hilo principal → Worker. */
export type ToWorker =
  | { type: 'reset'; archetypeId: string; seed: number }
  | { type: 'play'; yearsPerSecond: number }
  | { type: 'pause' }
  | { type: 'advance'; years: number };

/** Mensajes Worker → hilo principal. */
export type FromWorker =
  | { type: 'snapshot'; snapshot: RenderSnapshot }
  | { type: 'error'; message: string };
