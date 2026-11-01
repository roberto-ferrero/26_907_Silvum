import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPot, DEFAULT_POT, soilTopY } from './pot.ts';

export interface StageHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Punto del sustrato donde nacerá el árbol (metros, +Y arriba). */
  plantingPoint: THREE.Vector3;
  update(): void;
  resize(width: number, height: number): void;
}

/** Escena de estudio: fondo neutro, luz suave, mesa y maceta (fase 1.5). */
export function createStage(renderer: THREE.WebGPURenderer): StageHandle {
  const scene = new THREE.Scene();
  const background = new THREE.Color(0xd9d6cf);
  scene.background = background;
  scene.fog = new THREE.Fog(background, 3, 9);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 60);
  camera.position.set(1.9, 1.1, 2.5);

  const plantingPoint = new THREE.Vector3(0, soilTopY(DEFAULT_POT), 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.55, 0);
  controls.enableDamping = true;
  controls.minDistance = 0.4;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.update();

  // Luz de estudio: cielo/suelo, luz principal con sombras y relleno frío.
  scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x6b5f52, 1.1));

  const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
  key.position.set(2.5, 4, 1.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 12;
  key.shadow.camera.left = -1.5;
  key.shadow.camera.right = 1.5;
  key.shadow.camera.top = 1.5;
  key.shadow.camera.bottom = -1.5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xdfe8f5, 0.6);
  fill.position.set(-3, 2, -2);
  scene.add(fill);

  // Mesa circular que recibe sombras.
  const table = new THREE.Mesh(
    new THREE.CircleGeometry(12, 128),
    new THREE.MeshStandardMaterial({ color: 0xc9c3b8, roughness: 0.95 }),
  );
  table.rotation.x = -Math.PI / 2;
  table.receiveShadow = true;
  scene.add(table);

  scene.add(createPot(DEFAULT_POT));

  return {
    scene,
    camera,
    controls,
    plantingPoint,
    update: () => controls.update(),
    resize(width, height) {
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },
  };
}
