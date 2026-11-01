/**
 * Detección del backend efectivo de WebGPURenderer.
 *
 * El nombre WebGPURenderer no garantiza WebGPU: three.js puede caer a WebGL 2.
 * Por eso se comprueba después de `renderer.init()` y no solo con `navigator.gpu`
 * (especificación §12, T01).
 */
export type BackendKind = 'webgpu' | 'webgl2' | 'none';

export interface BackendStatus {
  kind: BackendKind;
  /** Si los módulos que necesitan compute WebGPU pueden activarse. */
  computeAvailable: boolean;
  level: 'ok' | 'warning' | 'error';
  message: string;
}

export function describeBackend(kind: BackendKind): BackendStatus {
  switch (kind) {
    case 'webgpu':
      return { kind, computeAvailable: true, level: 'ok', message: 'WebGPU activo.' };
    case 'webgl2':
      return {
        kind,
        computeAvailable: false,
        level: 'warning',
        message:
          'Este navegador no ofrece WebGPU y se está usando WebGL 2. ' +
          'La escena funciona, pero los cálculos de luz en GPU estarán desactivados. ' +
          'Usa Chrome o Edge recientes para la experiencia completa.',
      };
    case 'none':
      return {
        kind,
        computeAvailable: false,
        level: 'error',
        message: 'No se ha podido inicializar ni WebGPU ni WebGL 2 en este navegador.',
      };
  }
}

/** Lee el tipo de backend de un WebGPURenderer ya inicializado. */
export function backendKindOf(renderer: { backend?: { isWebGPUBackend?: boolean } }): BackendKind {
  const backend = renderer.backend;
  if (!backend) return 'none';
  return backend.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
}
