import * as THREE from 'three/webgpu';
import type { BranchRig } from '../fx/rig.ts';
import { ORGAN_STRIDE, type OrganBuffers } from '../sim/snapshot.ts';

/**
 * Órganos instanciados (hojas, flores, frutos) desde los búferes de la instantánea: una
 * instancia por órgano con pose, escala y color propios. Vista provisional hasta el LOD
 * por cohortes de la fase 6; no altera el estado biológico.
 */
export class OrganView {
  /** Contenedor estable: la malla interna se sustituye al cambiar geometría o capacidad. */
  readonly object = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private capacity = 0;
  private geometry: THREE.BufferGeometry | null = null;
  private geometryKey = '';
  private readonly material: THREE.MeshStandardMaterial;

  constructor(name: string, material: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    this.object.name = name;
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.75,
      metalness: 0,
      ...material,
    });
  }

  /** Textura con recorte por alfa (también en las sombras); null, sin ella. */
  setMask(texture: THREE.Texture | null): void {
    this.material.map = texture;
    this.material.alphaTest = texture ? 0.4 : 0;
    this.material.needsUpdate = true;
  }

  /** Cambia la geometría si `key` cambia (otra especie u otro individuo). */
  setGeometry(key: string, build: () => THREE.BufferGeometry): void {
    if (key === this.geometryKey) return;
    this.geometryKey = key;
    this.geometry?.dispose();
    this.geometry = build();
    this.rebuild(Math.max(this.capacity, 256));
  }

  private rebuild(capacity: number): void {
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.dispose();
    }
    if (!this.geometry) return;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // El atributo de color se crea desde el principio: el backend no lo detecta si aparece después.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.mesh = mesh;
    this.capacity = capacity;
    this.object.add(mesh);
  }

  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly posed = new Float32Array(7);

  /**
   * Copia `count` órganos del búfer (stride `ORGAN_STRIDE`). Con `rig`, cada órgano sigue
   * la pose deformada del nudo de su entrenudo.
   */
  update(buffers: OrganBuffers, rig?: BranchRig, look?: { keep: number; scale: number }): void {
    // Con `look.keep` < 1 se dibuja un subconjunto estable de órganos (por su posición).
    let indices: number[] | null = null;
    if (look && look.keep < 0.999) {
      indices = [];
      const d = buffers.data;
      for (let i = 0; i < buffers.count; i++) {
        const o = i * ORGAN_STRIDE;
        const h =
          Math.abs(
            Math.sin(d[o]! * 12.9898 + d[o + 1]! * 78.233 + d[o + 2]! * 37.719) * 43758.5453,
          ) % 1;
        if (h < look.keep) indices.push(i);
      }
    }
    const scaleMul = look?.scale ?? 1;
    this.write(indices ? indices.length : buffers.count, (k, out) => {
      const i = indices ? indices[k]! : k;
      const o = i * ORGAN_STRIDE;
      const d = buffers.data;
      if (rig?.rig) {
        rig.poseOrgan(d[o + 11]!, d, o, this.posed);
        const t = this.posed;
        out.position.set(t[0]!, t[1]!, t[2]!);
        out.quaternion.set(t[3]!, t[4]!, t[5]!, t[6]!);
      } else {
        out.position.set(d[o]!, d[o + 1]!, d[o + 2]!);
        out.quaternion.set(d[o + 3]!, d[o + 4]!, d[o + 5]!, d[o + 6]!);
      }
      out.scale = d[o + 7]! * scaleMul;
      out.color[0] = d[o + 8]!;
      out.color[1] = d[o + 9]!;
      out.color[2] = d[o + 10]!;
    });
  }

  private readonly slot = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: 1,
    color: [1, 1, 1] as [number, number, number],
  };

  /** Escribe `count` instancias con un rellenador (también lo usan las partículas). */
  write(count: number, fill: (i: number, out: OrganView['slot']) => void): void {
    if (!this.geometry) return;
    if (count > this.capacity || !this.mesh) {
      let capacity = Math.max(this.capacity, 256);
      while (capacity < count) capacity *= 2;
      this.rebuild(capacity);
    }
    const mesh = this.mesh!;
    const colors = mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < count; i++) {
      fill(i, this.slot);
      const sc = Math.max(1e-6, this.slot.scale);
      this.p.copy(this.slot.position);
      this.q.copy(this.slot.quaternion);
      this.s.set(sc, sc, sc);
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(i, this.m);
      colors[i * 3] = this.slot.color[0];
      colors[i * 3 + 1] = this.slot.color[1];
      colors[i * 3 + 2] = this.slot.color[2];
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }
}
