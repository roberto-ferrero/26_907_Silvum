import * as THREE from 'three/webgpu';
import { SNAPSHOT_STRIDE, type RenderSnapshot } from '../sim/snapshot.ts';

/**
 * Vista provisional del esqueleto: un cilindro troncocónico por entrenudo (instanciado).
 * Los tubos continuos con transporte paralelo llegan en la fase 6; esta vista no altera
 * el estado biológico y sirve de diagnóstico.
 */
const ROLE_COLORS = [0x5a4636, 0x6b5440, 0x7a6248, 0x8a7a55];
const DEAD_COLOR = 0x9a948a;

export class SkeletonView {
  readonly object: THREE.InstancedMesh;
  private capacity: number;
  private readonly geometry: THREE.CylinderGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  colorByRole = true;

  constructor(initialCapacity = 4096) {
    // Cilindro unitario con la base en el origen y eje +Y.
    this.geometry = new THREE.CylinderGeometry(1, 1, 1, 7, 1, false);
    this.geometry.translate(0, 0.5, 0);
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    this.capacity = initialCapacity;
    this.object = this.createMesh(initialCapacity);
  }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    // El atributo de color se crea desde el principio: el backend no lo detecta si aparece después.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.name = 'skeleton';
    return mesh;
  }

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly color = new THREE.Color();

  /** Devuelve una malla nueva si hubo que ampliar la capacidad (el llamador la sustituye). */
  update(snapshot: RenderSnapshot): THREE.InstancedMesh | null {
    const n = snapshot.segmentCount;
    let replaced: THREE.InstancedMesh | null = null;
    if (n > this.capacity) {
      while (this.capacity < n) this.capacity *= 2;
      replaced = this.createMesh(this.capacity);
      (this as { object: THREE.InstancedMesh }).object = replaced;
    }
    const mesh = this.object;
    const d = snapshot.segments;
    for (let i = 0; i < n; i++) {
      const o = i * SNAPSHOT_STRIDE;
      this.a.set(d[o]!, d[o + 1]!, d[o + 2]!);
      this.b.set(d[o + 3]!, d[o + 4]!, d[o + 5]!);
      this.dir.subVectors(this.b, this.a);
      const len = this.dir.length();
      if (len > 1e-6) this.dir.divideScalar(len);
      else this.dir.copy(this.up);
      this.q.setFromUnitVectors(this.up, this.dir);
      // Radio medio del tronco de cono; el ahusamiento real llega con los tubos (fase 6).
      const r = Math.max(0.0004, (d[o + 6]! + d[o + 7]!) / 2);
      this.scale.set(r, Math.max(len, 1e-5), r);
      this.m.compose(this.a, this.q, this.scale);
      mesh.setMatrixAt(i, this.m);
      const dead = d[o + 9]! > 0.5;
      const role = d[o + 8]! | 0;
      this.color.setHex(
        dead ? DEAD_COLOR : this.colorByRole ? (ROLE_COLORS[role] ?? 0x6b5440) : 0x5f4a38,
      );
      mesh.setColorAt(i, this.color);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return replaced;
  }
}
