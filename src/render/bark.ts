import * as THREE from 'three/webgpu';
import type { BranchRig } from '../fx/rig.ts';
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
    // Geometría inicial con todos los atributos: el backend compila el pipeline con ellos.
    this.object = new THREE.Mesh(BarkView.placeholder(), this.material);
    this.object.name = 'bark';
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.frustumCulled = false;
  }

  private static placeholder(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9), 3));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
    return g;
  }

  /** Posiciones y normales en reposo (las de la instantánea) para deformar con el rig. */
  private restPositions: Float32Array = new Float32Array(0);
  private restNormals: Float32Array = new Float32Array(0);

  update(mesh: BarkMesh): void {
    this.restPositions = mesh.positions;
    this.restNormals = mesh.normals;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals.slice(), 3));
    g.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    g.computeBoundingSphere();
    const old = this.object.geometry;
    this.object.geometry = g;
    old.dispose();
  }

  /** Aplica la pose del rig a la corteza. */
  applyRig(rig: BranchRig): void {
    const g = this.object.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    if (!rig.rig || pos.count * 3 !== this.restPositions.length) return;
    rig.deformBark(
      this.restPositions,
      this.restNormals,
      pos.array as Float32Array,
      nrm.array as Float32Array,
    );
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
  }
}
