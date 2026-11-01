import * as THREE from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { mrt, normalView, output, pass, renderOutput, screenUV } from 'three/tsl';

/**
 * Postprocesado suave (fase 6.8): oclusión ambiental GTAO (contacto entre hojas y ramas,
 * base del tronco con el sustrato), mezclada con suavidad sobre el color final, y la
 * conversión de tono ACES del renderer, con FXAA al final. Una sola pasada de escena con MRT (color y normales).
 * Solo con el backend WebGPU; con WebGL 2 se dibuja sin postprocesado.
 */
export interface PostHandle {
  render(): void;
  setEnabled(on: boolean): void;
}

export function createPost(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostHandle {
  const pipeline = new THREE.PostProcessing(renderer);
  // Sin MSAA en la pasada: GTAO necesita una profundidad no multimuestreada.
  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.setMRT(mrt({ output, normal: normalView }));
  const normal = scenePass.getTextureNode('normal');
  const depth = scenePass.getTextureNode('depth');
  const aoPass = ao(depth, normal, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = 0.12;
  aoPass.thickness.value = 0.6;
  aoPass.distanceFallOff.value = 0.5;
  const aoTexture = aoPass.getTextureNode();
  const color = scenePass.getTextureNode('output');
  const occlusion = aoTexture.sample(screenUV).r;
  // Mezcla suave: la oclusión total oscurece al 45 %, nunca a negro. Después, tono y
  // espacio de color, y FXAA para suavizar bordes (la pasada no lleva MSAA).
  pipeline.outputColorTransform = false;
  pipeline.outputNode = fxaa(renderOutput(color.mul(occlusion.mul(0.55).add(0.45))));
  let enabled = true;
  return {
    render() {
      if (enabled) pipeline.render();
      else renderer.render(scene, camera);
    },
    setEnabled(on) {
      enabled = on;
    },
  };
}
