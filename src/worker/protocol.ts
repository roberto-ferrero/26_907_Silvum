import type { LeafCycleMode } from '../sim/leaf-cycle.ts';
import type { UserLight } from '../sim/light.ts';
import type { OrganBuffers, RenderSnapshot } from '../sim/snapshot.ts';
import type { WindSettings } from '../sim/wind.ts';

/** Mensajes hilo principal → Worker. */
export type ToWorker =
  | { type: 'reset'; speciesId: string; seed: number }
  | { type: 'play'; yearsPerSecond: number }
  | { type: 'pause' }
  | { type: 'advance'; years: number }
  /** Salto a un año (adelante o atrás) con las instantáneas de la línea de tiempo. */
  | { type: 'seek'; years: number }
  | { type: 'wind'; wind: WindSettings }
  /** Luz del usuario (dirección, lateralidad e intensidad). */
  | { type: 'light'; light: UserLight }
  /** Ciclo de hojas: ligado al crecimiento o con su propia velocidad (años visuales/s). */
  | { type: 'leafCycle'; mode: LeafCycleMode; yearsPerSecond: number; playing: boolean }
  /** Fija la fase del año que muestra el ciclo de hojas (sin soltar hojas por el salto). */
  | { type: 'leafPhase'; phase: number };

/** Mensajes Worker → hilo principal. */
export type FromWorker =
  | { type: 'snapshot'; snapshot: RenderSnapshot }
  /** Ciclo de hojas independiente: hojas y caídas en la fase visual `phase`. */
  | {
      type: 'foliage';
      leaves: OrganBuffers;
      flowers: OrganBuffers;
      detachments: Float32Array;
      clockYears: number;
      phase: number;
    }
  /** Años de la línea de tiempo ya precalculados (saltos rápidos). */
  | { type: 'cache'; years: number }
  /** Coste medido en el Worker (ms): por tick biológico y por publicación. */
  | { type: 'perf'; tickMs: number; publishMs: number }
  /** El Worker está calculando un salto (la vista puede mostrarlo). */
  | { type: 'busy'; busy: boolean }
  | { type: 'error'; message: string };
