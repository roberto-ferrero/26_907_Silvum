import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NEUTRAL_LIGHT, type UserLight } from '../sim/light.ts';
import { createPot, DEFAULT_POT, soilTopY } from './pot.ts';
import { fogRange, seasonLook } from './seasonal-light.ts';

export interface StageHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Punto del sustrato donde nacerá el árbol (metros, +Y arriba). */
  plantingPoint: THREE.Vector3;
  /** Estación que se ve (fase del año) y bruma [0, 1] (fases 6.6-6.7). */
  setSeason(phase: number): void;
  setHaze(haze01: number): void;
  /** Luz del usuario: orienta y atenúa el sol de la estación (3.4). */
  setLight(light: UserLight): void;
  update(): void;
  resize(width: number, height: number): void;
}

/** Escena de estudio: fondo neutro, luz suave, mesa y maceta (fase 1.5). */
export function createStage(renderer: THREE.WebGPURenderer): StageHandle {
  const scene = new THREE.Scene();
  const background = new THREE.Color(0xd9d6cf);
  scene.background = background;
  scene.fog = new THREE.Fog(background, 3, 9);
  const fogRef = scene.fog;

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
  const hemi = new THREE.HemisphereLight(0xf4f1ea, 0x6b5f52, 1.1);
  scene.add(hemi);

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

  const fog = fogRef;
  let haze = 0;
  const applyFog = (): void => {
    const range = fogRange(haze);
    fog.near = range.near;
    fog.far = range.far;
  };
  let light: UserLight = NEUTRAL_LIGHT;
  let currentPhase = 0.55;
  const setSeason = (phase: number): void => {
    currentPhase = phase;
    const look = seasonLook(phase);
    const d = 5;
    // Con luz lateral, el sol llega del rumbo elegido y más bajo.
    const azimuth = light.lateral01 > 0 ? light.azimuthRad : look.sunAzimuth;
    const elevation = look.sunElevation * (1 - 0.55 * light.lateral01);
    key.position.set(
      d * Math.cos(elevation) * Math.cos(azimuth),
      d * Math.sin(elevation),
      d * Math.cos(elevation) * Math.sin(azimuth),
    );
    key.color.setRGB(...look.sunColor, THREE.SRGBColorSpace);
    key.intensity = look.sunIntensity * (0.25 + 0.75 * light.intensity01);
    hemi.color.setRGB(...look.skyColor, THREE.SRGBColorSpace);
    hemi.groundColor.setRGB(...look.groundColor, THREE.SRGBColorSpace);
    hemi.intensity = look.hemiIntensity * (0.6 + 0.4 * light.intensity01);
    // Con bruma, el fondo se aclara y se desatura hacia un gris perla.
    const bg = look.background.map((c) => c + (0.86 - c) * haze * 0.6) as [number, number, number];
    background.setRGB(...bg, THREE.SRGBColorSpace);
    fog.color.copy(background);
  };
  setSeason(0.55);

  return {
    scene,
    camera,
    controls,
    plantingPoint,
    setSeason,
    setLight(next) {
      light = next;
      setSeason(currentPhase);
    },
    setHaze(h) {
      haze = Math.max(0, Math.min(1, h));
      applyFog();
    },
    update: () => controls.update(),
    resize(width, height) {
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    },
  };
}
