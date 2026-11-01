import type { LeafCycleMode } from '../sim/leaf-cycle.ts';
import type { OrganBuffers, RenderSnapshot } from '../sim/snapshot.ts';
import type { WindSettings } from '../sim/wind.ts';

/** Mensajes hilo principal → Worker. */
export type ToWorker =
  | { type: 'reset'; speciesId: string; seed: number }
  | { type: 'play'; yearsPerSecond: number }
  | { type: 'pause' }
  | { type: 'advance'; years: number }
  | { type: 'wind'; wind: WindSettings }
  /** Ciclo de hojas: ligado al crecimiento o con su propia velocidad (años visuales/s). */
  | { type: 'leafCycle'; mode: LeafCycleMode; yearsPerSecond: number };

/** Mensajes Worker → hilo principal. */
export type FromWorker =
  | { type: 'snapshot'; snapshot: RenderSnapshot }
  /** Ciclo de hojas independiente: hojas y caídas en la fase visual `phase`. */
  | {
      type: 'foliage';
      leaves: OrganBuffers;
      detachments: Float32Array;
      clockYears: number;
      phase: number;
    }
  | { type: 'error'; message: string };
