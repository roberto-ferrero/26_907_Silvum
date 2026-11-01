import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Maceta de bonsái rectangular y poco profunda, con sustrato.
 * Es solo presentación: no limita el crecimiento simulado (decisión 2).
 * Unidades: metros. El borde superior del sustrato queda en `soilTopY`.
 */
export interface PotDimensions {
  width: number;
  depth: number;
  height: number;
  wall: number;
  footHeight: number;
}

export const DEFAULT_POT: PotDimensions = {
  width: 0.56,
  depth: 0.38,
  height: 0.11,
  wall: 0.018,
  footHeight: 0.022,
};

/** El sustrato asoma ligeramente sobre el borde, como en un bonsái recién trasplantado. */
export const SOIL_MOUND = 0.006;

export function soilTopY(d: PotDimensions): number {
  return d.footHeight + d.height + SOIL_MOUND;
}

export function createPot(d: PotDimensions = DEFAULT_POT): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pot';

  const glaze = new THREE.MeshStandardMaterial({ color: 0x4a3b33, roughness: 0.55, metalness: 0 });
  const clay = new THREE.MeshStandardMaterial({ color: 0x3a2e28, roughness: 0.9, metalness: 0 });
  const soil = new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1, metalness: 0 });

  const body = new THREE.Mesh(new RoundedBoxGeometry(d.width, d.height, d.depth, 4, 0.012), glaze);
  body.position.y = d.footHeight + d.height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const lipHeight = 0.014;
  const lip = new THREE.Mesh(
    new RoundedBoxGeometry(d.width + 0.02, lipHeight, d.depth + 0.02, 3, 0.006),
    glaze,
  );
  lip.position.y = d.footHeight + d.height - lipHeight / 2;
  lip.castShadow = true;
  group.add(lip);

  const soilThickness = 0.02;
  const soilMesh = new THREE.Mesh(
    new RoundedBoxGeometry(d.width - 2 * d.wall, soilThickness, d.depth - 2 * d.wall, 3, 0.008),
    soil,
  );
  soilMesh.position.y = soilTopY(d) - soilThickness / 2;
  soilMesh.receiveShadow = true;
  soilMesh.name = 'soil';
  group.add(soilMesh);

  const footGeometry = new RoundedBoxGeometry(0.07, d.footHeight, 0.05, 2, 0.004);
  const fx = d.width / 2 - 0.06;
  const fz = d.depth / 2 - 0.045;
  for (const [x, z] of [
    [fx, fz],
    [-fx, fz],
    [fx, -fz],
    [-fx, -fz],
  ] as const) {
    const foot = new THREE.Mesh(footGeometry, clay);
    foot.position.set(x, d.footHeight / 2, z);
    foot.castShadow = true;
    group.add(foot);
  }

  return group;
}
