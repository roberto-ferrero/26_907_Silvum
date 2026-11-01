import * as THREE from 'three/webgpu';

/**
 * Mapa de luz de diagnóstico (fase 7.6): un punto por yema viva coloreado por su
 * exposición (azul = sombra, amarillo = luz plena). Oculto por defecto.
 */
export class LightMapView {
  readonly object: THREE.Points;
  private readonly shade = new THREE.Color(0x2b4dd6);
  private readonly sun = new THREE.Color(0xffd23f);
  private readonly c = new THREE.Color();

  constructor() {
    const material = new THREE.PointsMaterial({
      size: 0.012,
      vertexColors: true,
      depthTest: false,
    });
    this.object = new THREE.Points(new THREE.BufferGeometry(), material);
    this.object.name = 'light-map';
    this.object.visible = false;
    this.object.renderOrder = 10;
    this.object.frustumCulled = false;
  }

  /** `data`: x, y, z, exposición por yema. */
  update(data: Float32Array): void {
    const n = data.length / 4;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set(data.subarray(i * 4, i * 4 + 3), i * 3);
      this.c.copy(this.shade).lerp(this.sun, Math.max(0, Math.min(1, data[i * 4 + 3]!)));
      col.set([this.c.r, this.c.g, this.c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const old = this.object.geometry;
    this.object.geometry = g;
    old.dispose();
  }
}
