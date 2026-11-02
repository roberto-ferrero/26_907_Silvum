import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FloweringProgram, FruitingProgram, LeafForm, LeafShape } from '../sim/species.ts';

/**
 * Geometría de órganos (fase 4.6.1). Todas con longitud 1 en su eje local y: la escala de
 * cada instancia (m) viene de la instantánea. Hojas en el plano xy con la normal en +z y
 * la base del pecíolo en el origen. El color de vértice es un factor (nervios, cúpula,
 * centro de la flor) que multiplica el color de la instancia.
 */

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Envolvente base (0-1) de media anchura por forma, a lo largo del limbo u ∈ [0, 1]. */
function envelope(shape: LeafShape, u: number): number {
  const beta = (a: number, b: number): number => {
    // Máximo de u^a (1-u)^b en u = a / (a + b), para normalizar a 1.
    const m = a / (a + b);
    return (u ** a * (1 - u) ** b) / (m ** a * (1 - m) ** b);
  };
  switch (shape) {
    case 'needle':
      return Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 8));
    case 'scale':
      return beta(0.7, 0.6);
    case 'ovate':
      return beta(0.55, 0.85);
    case 'lanceolate':
      return beta(0.5, 1.25);
    case 'lobed':
      return beta(0.85, 0.55);
  }
}

/** Media anchura (relativa a la longitud) de la hoja en la posición u del limbo. */
export function leafHalfWidth(form: LeafForm, u: number): number {
  let w = envelope(form.shape, u);
  if (form.shape === 'lobed' && form.lobes > 0) {
    // Lóbulos redondeados con senos; aurículas en la base (Quercus robur).
    const m = Math.abs(Math.sin(Math.PI * (form.lobes * u * 0.92 + 0.35)));
    w *= 1 - form.lobeDepth + form.lobeDepth * m ** 0.6;
    w += 0.25 * (1 - smoothstep(0, 0.12, u)) * smoothstep(0, 0.03, u);
  }
  if (form.teeth > 0 && form.toothDepth > 0) {
    const saw = (form.teeth * u) % 1;
    w *= 1 - form.toothDepth * saw;
  }
  return (w * form.widthRatio) / 2;
}

function leafBlade(form: LeafForm, nu: number, nv: number): THREE.BufferGeometry {
  const petiole = form.petioleRatio;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const fold = Math.tan((form.foldDeg * Math.PI) / 180);
  const cols = 2 * nv + 1;
  for (let i = 0; i <= nu; i++) {
    const y = i / nu;
    const inBlade = y >= petiole;
    const u = inBlade ? (y - petiole) / Math.max(1e-6, 1 - petiole) : 0;
    const half = inBlade ? Math.max(leafHalfWidth(form, u), 0.004) : 0.006;
    for (let j = -nv; j <= nv; j++) {
      const v = j / nv;
      const x = v * half;
      const z = fold * Math.abs(x) - form.curl * y * y;
      positions.push(x, y, z);
      // Nervio medio y nervios secundarios más oscuros (solo visual).
      let shade = 1;
      if (Math.abs(v) < 0.12) shade = 0.78;
      else if (form.veinPairs > 0 && inBlade) {
        const s = (u - 0.55 * Math.abs(v) * form.widthRatio) * form.veinPairs;
        const d = Math.abs(s - Math.round(s));
        if (d < 0.12) shade = 0.86;
      }
      shade *= 0.92 + 0.08 * (1 - Math.abs(v)); // margen algo más claro por transmisión
      colors.push(shade, shade, shade);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + cols;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Media anchura del rectángulo que contiene la hoja (con margen, relativa a la longitud). */
function leafBoundHalfWidth(form: LeafForm): number {
  let max = 0.02;
  for (let i = 0; i <= 64; i++) max = Math.max(max, leafHalfWidth(form, i / 64));
  return max * 1.08;
}

/**
 * Máscara de una hoja plana (RGBA, filas de la base al ápice): alfa = dentro del contorno
 * con pecíolo; RGB = factor de color con nervio medio y secundarios. El RGB se rellena
 * también fuera del contorno para que el filtrado no oscurezca los bordes.
 */
export function rasterizeLeafMask(form: LeafForm, width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const bound = leafBoundHalfWidth(form);
  const petiole = form.petioleRatio;
  for (let row = 0; row < height; row++) {
    const y = (row + 0.5) / height;
    const inBlade = y >= petiole;
    const u = inBlade ? (y - petiole) / Math.max(1e-6, 1 - petiole) : 0;
    const half = inBlade ? leafHalfWidth(form, u) : 0.012;
    for (let col = 0; col < width; col++) {
      const x = (((col + 0.5) / width) * 2 - 1) * bound;
      const v = half > 1e-6 ? Math.abs(x) / half : 2;
      let shade = 0.92 + 0.08 * (1 - Math.min(1, v)); // margen algo más claro
      if (Math.abs(x) < 0.008) shade *= 0.72;
      else if (form.veinPairs > 0 && inBlade) {
        const s = (u - 0.55 * Math.abs(x)) * form.veinPairs;
        if (Math.abs(s - Math.round(s)) < 0.07) shade *= 0.84;
      }
      const o = (row * width + col) * 4;
      const c = Math.round(shade * 255);
      data[o] = c;
      data[o + 1] = c;
      data[o + 2] = c;
      data[o + 3] = Math.abs(x) <= half ? 255 : 0;
    }
  }
  return data;
}

/** Textura de la hoja (null en acículas, que son geometría). */
export function createLeafTexture(form: LeafForm): THREE.DataTexture | null {
  if (form.shape === 'needle') return null;
  const width = 128;
  const height = 256;
  const texture = new THREE.DataTexture(rasterizeLeafMask(form, width, height), width, height);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Limbo de 8 triángulos: el contorno lo recorta la máscara, y la malla solo da el plegado
 * por el nervio medio y la curvatura. Con miles de hojas (y otra vez en las sombras) una
 * malla que siguiera el contorno se llevaba casi todo el coste de dibujo.
 */
function leafCard(form: LeafForm): THREE.BufferGeometry {
  const bound = leafBoundHalfWidth(form);
  const fold = Math.tan((form.foldDeg * Math.PI) / 180);
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= 2; i++) {
    const y = i / 2;
    for (let j = -1; j <= 1; j++) {
      const x = j * bound;
      positions.push(x, y, fold * Math.abs(x) - form.curl * y * y);
      uvs.push((j + 1) / 2, y);
      colors.push(1, 1, 1);
    }
  }
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * Geometría de una unidad foliar. Aguja: un haz de tres acículas en abanico
 * (una instancia por haz). Resto: un limbo recortado con `createLeafTexture`.
 */
export function createLeafGeometry(form: LeafForm): THREE.BufferGeometry {
  if (form.shape !== 'needle') return leafCard(form);
  const needle = leafBlade(form, 2, 1);
  const parts = [-0.32, 0, 0.32].map((angle, k) => {
    const g = needle.clone();
    g.scale(1, 0.85 + 0.15 * k, 1);
    g.rotateZ(angle);
    g.translate(0, (k - 1) * 0.12, 0);
    return g;
  });
  return mergeGeometries(parts) ?? needle;
}

/**
 * Manojo de `n` hojas desde un mismo punto (dirección de arte): la del centro a lo largo
 * de +y y las demás abiertas en abanico y algo giradas, un poco menores.
 */
export function createLeafClusterGeometry(form: LeafForm, n: number): THREE.BufferGeometry {
  const leaf = createLeafGeometry(form);
  if (n <= 1) return leaf;
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const g = leaf.clone();
    if (k > 0) {
      const side = k % 2 === 1 ? 1 : -1;
      const step = Math.ceil(k / 2);
      g.scale(0.82, 0.82, 0.82);
      g.rotateY(side * 0.35 * step);
      g.rotateZ(side * 0.6 * step);
      g.rotateX(-0.15 * step);
    }
    parts.push(g);
  }
  return mergeGeometries(parts) ?? leaf;
}

function petalGeometry(): THREE.BufferGeometry {
  const form: LeafForm = {
    shape: 'ovate',
    lengthM: 1,
    widthRatio: 0.85,
    lobes: 0,
    lobeDepth: 0,
    teeth: 0,
    toothDepth: 0,
    veinPairs: 0,
    foldDeg: 0,
    curl: -0.15,
    petioleRatio: 0.08,
  };
  return leafBlade(form, 8, 3);
}

/** Color de vértice uniforme; quita las uv para que todas las piezas se puedan fusionar. */
function tint(g: THREE.BufferGeometry, r: number, gr: number, b: number): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([r, gr, b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Pétalo suelto (partículas). Longitud 1 a lo largo de y. */
export function createPetalGeometry(): THREE.BufferGeometry {
  return petalGeometry();
}

/**
 * Flor abierta con la corola hacia +z (diámetro 1). Sin pétalos vistosos: un pequeño
 * glomérulo (flores femeninas del roble).
 */
export function createFlowerGeometry(program: FloweringProgram): THREE.BufferGeometry {
  if (program.petals === 0) {
    return tint(new THREE.IcosahedronGeometry(0.5, 1), 1, 1, 1);
  }
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < program.petals; k++) {
    const p = petalGeometry();
    p.scale(0.5, 0.5, 0.5);
    p.rotateX(-0.35); // corola algo acopada
    p.rotateZ((k / program.petals) * Math.PI * 2);
    parts.push(p.toNonIndexed());
  }
  const center = new THREE.SphereGeometry(0.12, 8, 6).toNonIndexed();
  center.translate(0, 0, 0.04);
  parts.push(tint(center, 0.85, 0.45, 0.55));
  return mergeGeometries(parts) ?? parts[0]!;
}

/** Fruto colgando: el pedúnculo en el origen y el cuerpo hacia -y (longitud 1). */
export function createFruitGeometry(program: FruitingProgram): THREE.BufferGeometry {
  const stalk = tint(
    new THREE.CylinderGeometry(0.03, 0.03, 0.18, 5).toNonIndexed(),
    0.7,
    0.62,
    0.5,
  );
  stalk.translate(0, -0.09, 0);
  if (program.kind === 'acorn') {
    const nut = tint(new THREE.SphereGeometry(0.5, 14, 10).toNonIndexed(), 1, 1, 1);
    nut.scale(0.62, 0.82, 0.62);
    nut.translate(0, -0.62, 0);
    const cup = tint(
      new THREE.SphereGeometry(0.36, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(),
      0.62,
      0.5,
      0.34,
    );
    cup.translate(0, -0.42, 0);
    cup.scale(1, 0.9, 1);
    return mergeGeometries([stalk, nut, cup]) ?? nut;
  }
  // Drupa del almendro: ovoide algo aplanado y aterciopelado.
  const body = tint(new THREE.SphereGeometry(0.5, 16, 12).toNonIndexed(), 1, 1, 1);
  body.scale(0.7, 0.9, 0.52);
  body.translate(0, -0.6, 0);
  return mergeGeometries([stalk, body]) ?? body;
}
