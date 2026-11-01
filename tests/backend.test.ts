import { describe, expect, it } from 'vitest';
import { backendKindOf, describeBackend } from '../src/render/backend.ts';

describe('detección de backend', () => {
  it('reconoce WebGPU real', () => {
    expect(backendKindOf({ backend: { isWebGPUBackend: true } })).toBe('webgpu');
  });

  it('trata cualquier otro backend como fallback WebGL 2', () => {
    expect(backendKindOf({ backend: {} })).toBe('webgl2');
    expect(backendKindOf({ backend: { isWebGPUBackend: false } })).toBe('webgl2');
  });

  it('sin backend no hay render', () => {
    expect(backendKindOf({})).toBe('none');
  });

  it('solo WebGPU habilita compute', () => {
    expect(describeBackend('webgpu').computeAvailable).toBe(true);
    expect(describeBackend('webgl2').computeAvailable).toBe(false);
    expect(describeBackend('webgl2').level).toBe('warning');
    expect(describeBackend('none').level).toBe('error');
  });
});
