import { normalizeOr, type Vec3 } from './vec3.ts';

/**
 * Campo de luz PROVISIONAL: propagación de sombra en rejilla de Pałubicki et al. 2009 (§4.1).
 * Cada órgano fotosintético sombrea una pirámide de celdas por debajo. Se sustituirá en la
 * fase 3 por atenuación exponencial con muestras de cielo; la interfaz `LightField` se conserva.
 * Rejilla dispersa: solo existen las celdas con sombra.
 *
 * Añadido de la fase 4 (adelanto de 3.2): un término de CIELO LATERAL. La pirámide solo
 * sombrea hacia abajo, así que un punto bajo y periférico de la copa nunca recibía la luz
 * del horizonte, que es la que mantiene vivas las ramas bajas de un árbol aislado. Se
 * estima con rayos horizontales que atenúan exponencialmente con la densidad de órganos.
 */
export interface LightField {
  /** Exposición normalizada en [0, 1]. */
  exposure(p: Vec3): number;
  /** Dirección favorable (hacia menos sombra), o null si es indiferente. */
  favorableDirection(p: Vec3): Vec3 | null;
}

export interface ShadowGridParams {
  cellSizeM: number;
  /** Profundidad de la pirámide en celdas. */
  depth: number;
  /** Sombra que deja un órgano en su celda. */
  a: number;
  /** Base del decaimiento con la profundidad: a·b^-q. */
  b: number;
  /** Luz plena: exposición = max(0, C - s) / C. */
  fullLight: number;
  /** Peso del cielo lateral en la exposición (0 = solo la pirámide). */
  lateralWeight: number;
  /** Alcance de los rayos laterales (celdas) y atenuación por unidad de peso de órgano. */
  lateralReach: number;
  lateralAttenuation: number;
}

export const DEFAULT_SHADOW: ShadowGridParams = {
  cellSizeM: 0.025,
  depth: 6,
  a: 1,
  b: 2,
  fullLight: 4,
  lateralWeight: 0,
  lateralReach: 12,
  lateralAttenuation: 0.35,
};

/** Direcciones horizontales de los rayos laterales (8 rumbos). */
const LATERAL_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Rejilla densa sobre la caja envolvente de los órganos (más un margen de `depth` celdas
 * por los lados y por debajo). Fuera de la caja no hay sombra: no se introduce oscuridad
 * por defecto fuera de la copa (especificación §6).
 */
export class ShadowGrid implements LightField {
  private readonly cells: Float32Array;
  /** Peso de órganos por celda (para los rayos laterales). */
  private readonly density: Float32Array;
  private readonly origin: [number, number, number];
  private readonly dims: [number, number, number];

  constructor(
    occluders: readonly { position: Vec3; weight: number }[],
    private readonly params: ShadowGridParams = DEFAULT_SHADOW,
  ) {
    const c = params.cellSizeM;
    let min: [number, number, number] = [Infinity, Infinity, Infinity];
    let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const o of occluders) {
      for (let a = 0; a < 3; a++) {
        const v = Math.floor(o.position[a]! / c);
        min[a] = Math.min(min[a]!, v);
        max[a] = Math.max(max[a]!, v);
      }
    }
    if (occluders.length === 0) {
      min = [0, 0, 0];
      max = [0, 0, 0];
    }
    const m = params.depth + 1;
    this.origin = [min[0] - m, min[1] - m, min[2] - m];
    this.dims = [max[0] - min[0] + 2 * m + 1, max[1] - min[1] + m + 2, max[2] - min[2] + 2 * m + 1];
    this.cells = new Float32Array(this.dims[0] * this.dims[1] * this.dims[2]);
    this.density = new Float32Array(this.cells.length);
    // La pirámide es lineal en el peso: se agregan los órganos por celda y se propaga
    // una pirámide por celda ocupada (muchas yemas y hojas comparten celda).
    const [, ny, nz] = this.dims;
    const byCell = new Map<number, number>();
    for (const o of occluders) {
      const [i, j, k] = this.cellOf(o.position);
      const key = (i * ny + j) * nz + k;
      byCell.set(key, (byCell.get(key) ?? 0) + o.weight);
    }
    const keys = [...byCell.keys()].sort((x, y) => x - y);
    for (const key of keys) {
      const k = key % nz;
      const j = ((key - k) / nz) % ny;
      const i = (key - k - j * nz) / (ny * nz);
      this.addOccluderAtCell(i, j, k, byCell.get(key)!);
      this.density[key] = byCell.get(key)!;
    }
  }

  private cellOf(p: Vec3): [number, number, number] {
    const c = this.params.cellSizeM;
    return [
      Math.floor(p[0] / c) - this.origin[0],
      Math.floor(p[1] / c) - this.origin[1],
      Math.floor(p[2] / c) - this.origin[2],
    ];
  }

  private index(i: number, j: number, k: number): number {
    const [nx, ny, nz] = this.dims;
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
    return (i * ny + j) * nz + k;
  }

  private addOccluderAtCell(i: number, j: number, k: number, weight: number): void {
    const { depth, a, b } = this.params;
    const [nx, ny, nz] = this.dims;
    const cells = this.cells;
    // q empieza en 1: los órganos de un mismo nudo (misma celda) no se sombrean entre sí.
    for (let q = 1; q <= depth; q++) {
      const s = weight * a * b ** -q;
      const jj = j - q;
      if (jj < 0) break;
      const i0 = Math.max(0, i - q);
      const i1 = Math.min(nx - 1, i + q);
      const k0 = Math.max(0, k - q);
      const k1 = Math.min(nz - 1, k + q);
      for (let ii = i0; ii <= i1; ii++) {
        const row = (ii * ny + jj) * nz;
        for (let kk = k0; kk <= k1; kk++) cells[row + kk] = cells[row + kk]! + s;
      }
    }
  }

  private shadowAtCell(i: number, j: number, k: number): number {
    const id = this.index(i, j, k);
    return id >= 0 ? this.cells[id]! : 0;
  }

  exposure(p: Vec3): number {
    const [i, j, k] = this.cellOf(p);
    const { fullLight, lateralWeight } = this.params;
    const top = Math.max(0, fullLight - this.shadowAtCell(i, j, k)) / fullLight;
    if (lateralWeight <= 0) return top;
    return (1 - lateralWeight) * top + lateralWeight * this.lateralSky(i, j, k);
  }

  /** Transmisión media del cielo lateral: rayos horizontales desde la celda. */
  private lateralSky(i: number, j: number, k: number): number {
    const { lateralReach, lateralAttenuation } = this.params;
    const [nx, ny, nz] = this.dims;
    if (j < 0 || j >= ny) return 1;
    let total = 0;
    for (const [dx, dz] of LATERAL_DIRS) {
      let acc = 0;
      for (let d = 1; d <= lateralReach; d++) {
        const ii = i + dx * d;
        const kk = k + dz * d;
        if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) break; // fuera de la caja: cielo despejado
        acc += this.density[(ii * ny + j) * nz + kk]!;
      }
      total += Math.exp(-lateralAttenuation * acc);
    }
    return total / LATERAL_DIRS.length;
  }

  favorableDirection(p: Vec3): Vec3 | null {
    const [i, j, k] = this.cellOf(p);
    let best = Infinity;
    let dir: Vec3 = [0, 0, 0];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          if (di === 0 && dj === 0 && dk === 0) continue;
          // `dir` acumula los empates para no sesgar hacia el primer vecino recorrido.
          const s = this.shadowAtCell(i + di, j + dj, k + dk);
          if (s < best - 1e-6) {
            best = s;
            dir = [di, dj, dk];
          } else if (Math.abs(s - best) <= 1e-6) {
            dir = [dir[0] + di, dir[1] + dj, dir[2] + dk];
          }
        }
      }
    }
    const n = normalizeOr(dir, [0, 0, 0]);
    return n[0] === 0 && n[1] === 0 && n[2] === 0 ? null : n;
  }

  get cellCount(): number {
    return this.cells.length;
  }
}
