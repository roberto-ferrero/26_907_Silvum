import * as THREE from 'three/webgpu';
import { backendKindOf, describeBackend, type BackendStatus } from './backend.ts';

export interface RendererHandle {
  renderer: THREE.WebGPURenderer;
  status: BackendStatus;
}

export interface RendererOptions {
  /** Fuerza el backend WebGL 2 (útil para depurar o comparar). Se activa con `?backend=webgl`. */
  forceWebGL?: boolean;
  /** MSAA del lienzo. Sin él cuando hay postprocesado (lo sustituye FXAA). */
  antialias?: boolean;
}

export async function createRenderer(
  container: HTMLElement,
  options: RendererOptions = {},
): Promise<RendererHandle> {
  const renderer = new THREE.WebGPURenderer({
    antialias: options.antialias ?? true,
    forceWebGL: options.forceWebGL ?? false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  try {
    await renderer.init();
  } catch (error) {
    console.error('[Silvum] Fallo al inicializar el renderer', error);
    return { renderer, status: describeBackend('none') };
  }

  container.appendChild(renderer.domElement);
  const status = describeBackend(backendKindOf(renderer as never));
  console.info(`[Silvum] Backend: ${status.kind}`);
  return { renderer, status };
}
