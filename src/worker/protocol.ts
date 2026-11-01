import type { RenderSnapshot } from '../sim/snapshot.ts';
import type { WindSettings } from '../sim/wind.ts';

/** Mensajes hilo principal → Worker. */
export type ToWorker =
  | { type: 'reset'; speciesId: string; seed: number }
  | { type: 'play'; yearsPerSecond: number }
  | { type: 'pause' }
  | { type: 'advance'; years: number }
  | { type: 'wind'; wind: WindSettings };

/** Mensajes Worker → hilo principal. */
export type FromWorker =
  | { type: 'snapshot'; snapshot: RenderSnapshot }
  | { type: 'error'; message: string };
