import * as THREE from 'three/webgpu';
import type { BarkMesh } from '../sim/bark-mesh.ts';

/**
 * Corteza continua (tubos por eje) desde la instantánea del Worker. Sustituye a la vista
 * de cilindros sueltos; la geometría se reemplaza en cada publicación.
 */
export class BarkView {
  readonly object: THREE.Mesh;
  private readonly material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0,
  });

  constructor() {
    this.object = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.object.name = 'bark';
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.frustumCulled = false;
  }

  update(mesh: BarkMesh): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const old = this.object.geometry;
    this.object.geometry = g;
    old.dispose();
  }
}
