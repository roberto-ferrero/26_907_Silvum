import * as THREE from 'three/webgpu';
import {
  attribute,
  bumpMap,
  float,
  mix,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  smoothstep,
  vec3,
  vertexColor,
} from 'three/tsl';
import type { BranchRig } from '../fx/rig.ts';
import type { BarkMesh } from '../sim/bark-mesh.ts';

/**
 * Corteza continua (tubos por eje) desde la instantánea del Worker. Sustituye a la vista
 * de cilindros sueltos; la geometría se reemplaza en cada publicación.
 */
export class BarkView {
  readonly object: THREE.Mesh;
  private readonly material = BarkView.createMaterial();

  /**
   * Corteza procedimental (6.3): grietas verticales (Worley estirado a lo largo del eje)
   * que se abren con la madurez, veteado fino con ruido fractal, color más oscuro en el
   * fondo de las grietas y relieve por mapa de alturas. Sin texturas que cargar.
   */
  private static createMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.93, metalness: 0 });
    const uv = attribute<'vec2'>('barkUv', 'vec2');
    const age = attribute<'float'>('barkAge', 'float');
    const cracks = mx_worley_noise_float(vec3(uv.x.mul(55), uv.y.mul(14), float(0)));
    const grain = mx_fractal_noise_float(vec3(uv.x.mul(160), uv.y.mul(40), float(3)), 3);
    const ridge = smoothstep(0.05, 0.45, cracks); // 0 en la grieta, 1 en la placa
    const height = mix(float(1), ridge, age).add(grain.mul(0.08));
    m.colorNode = vertexColor()
      .mul(mix(float(1), ridge.mul(0.5).add(0.55), age))
      .mul(grain.mul(0.12).add(1));
    m.normalNode = bumpMap(height, float(0.6));
    return m;
  }

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
    g.setAttribute('barkUv', new THREE.BufferAttribute(new Float32Array(6), 2));
    g.setAttribute('barkAge', new THREE.BufferAttribute(new Float32Array(3), 1));
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
    g.setAttribute('barkUv', new THREE.BufferAttribute(mesh.barkUv, 2));
    g.setAttribute('barkAge', new THREE.BufferAttribute(mesh.barkAge, 1));
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
