/**
 * Partículas de órganos que caen (fase 4.6.8-4.6.9): hojas, pétalos y frutos.
 *
 * Es un sistema VISUAL: parte de los desprendimientos que publica el núcleo y nunca
 * vuelve al estado biológico. Modelo fenomenológico de hoja que cae:
 *   dv/dt = g + k·(w − v) + a_balanceo,   k = g / v_terminal
 * con w la velocidad del aire (campo de viento compartido), un balanceo lateral periódico
 * cuyo plano gira lentamente (vaivén de hoja) y giro/volteo de la orientación. Los frutos
 * casi no notan el aire (v_terminal alta) y rebotan una vez. En el suelo o en la maceta
 * quedan planos y se desvanecen con el tiempo SIMULADO (descomposición).
 * Sin dependencias de three.js: se prueba en Node.
 */
import { DETACH_KIND, DETACH_STRIDE } from '../sim/organs.ts';
import { windVelocityAt, type WindSettings } from '../sim/wind.ts';

export type Kind = (typeof DETACH_KIND)[keyof typeof DETACH_KIND];
export type Quat = [number, number, number, number];
export type V3 = [number, number, number];

/** Altura del suelo (m, coordenadas del árbol) bajo (x, z). */
export type Ground = (x: number, z: number) => number;

export interface FallParams {
  /** Velocidad de caída en aire en calma (m/s). */
  terminalVelocity: number;
  /** Aceleración del balanceo lateral (m/s²) y su frecuencia (Hz). */
  flutterAccel: number;
  flutterHz: number;
  /** Amplitud del cabeceo durante el balanceo (rad). */
  tiltAmp: number;
  /** Velocidad máxima de volteo (rad/s). */
  tumbleRate: number;
  /** Coeficiente de rebote al tocar el suelo. */
  restitution: number;
  /** Años simulados hasta desaparecer en el suelo. */
  decayYears: number;
}

export const FALL_PARAMS: Record<Kind, FallParams> = {
  [DETACH_KIND.leaf]: {
    terminalVelocity: 0.9,
    flutterAccel: 2.2,
    flutterHz: 1.3,
    tiltAmp: 0.7,
    tumbleRate: 2.5,
    restitution: 0,
    decayYears: 0.35,
  },
  [DETACH_KIND.petal]: {
    terminalVelocity: 0.45,
    flutterAccel: 1.6,
    flutterHz: 1.8,
    tiltAmp: 0.9,
    tumbleRate: 4,
    restitution: 0,
    decayYears: 0.06,
  },
  [DETACH_KIND.fruit]: {
    terminalVelocity: 16,
    flutterAccel: 0,
    flutterHz: 0,
    tiltAmp: 0,
    tumbleRate: 1.5,
    restitution: 0.25,
    decayYears: 0.5,
  },
};

const G = 9.81;
/** Caídas más antiguas que esto (años) ya no se animan: aparecen en el suelo. */
const STALE_YEARS = 0.08;
/** Color (lineal) al que tienden los órganos al descomponerse. */
const SOIL: V3 = [0.075, 0.05, 0.032];

export interface Particle {
  kind: Kind;
  position: V3;
  velocity: V3;
  /** Orientación al desprenderse. */
  q0: Quat;
  /** Orientación actual. */
  q: Quat;
  scale: number;
  color: V3;
  /** Segundos de espera antes de soltarse (se reparte la caída de un tick). */
  delay: number;
  phase: number;
  yaw: number;
  yawRate: number;
  tumble: number;
  tumbleRate: number;
  landed: boolean;
  landedAtYears: number;
  bounced: boolean;
}

// ── Cuaterniones mínimos ─────────────────────────────────────────────────────────

export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatAxisAngle(axis: V3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function rotate(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/** Orientación de reposo: tendido en el suelo, con el eje y en horizontal. */
function restingQuat(q: Quat): Quat {
  const y = rotate(q, [0, 1, 0]);
  let hx = y[0];
  let hz = y[2];
  const n = Math.hypot(hx, hz);
  if (n < 1e-6) {
    hx = 1;
    hz = 0;
  } else {
    hx /= n;
    hz /= n;
  }
  // Base (x, y, z) = (y × up, horizontal, up) → cuaternión. Giro alrededor de +Y que
  // lleva +Y local a (hx, 0, hz) tras tumbar: z local apunta al cielo.
  const lay = quatAxisAngle([1, 0, 0], -Math.PI / 2); // y local → -z mundo, z local → y mundo
  const yaw = Math.atan2(-hx, -hz);
  return quatMul(quatAxisAngle([0, 1, 0], yaw), lay);
}

// ── Sistema ──────────────────────────────────────────────────────────────────────

export interface FallingOptions {
  maxFalling: number;
  maxResting: number;
}

export class FallingOrgans {
  readonly particles: Particle[] = [];
  private rng = 0x2545f491;

  constructor(private readonly options: FallingOptions = { maxFalling: 2500, maxResting: 4000 }) {}

  private random(): number {
    // xorshift32: variación visual reproducible (no interviene en la biología).
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng / 4294967296;
  }

  get fallingCount(): number {
    return this.particles.reduce((n, p) => n + (p.landed ? 0 : 1), 0);
  }

  /**
   * Añade los desprendimientos de una publicación. `delayOf` reparte cada caída dentro
   * del tiempo real que dura el lote (según su instante simulado).
   */
  spawn(
    records: Float32Array,
    ground: Ground,
    nowYears: number,
    delayOf: (timeYears: number) => number = () => 0,
  ): void {
    let falling = this.fallingCount;
    for (let o = 0; o + DETACH_STRIDE <= records.length; o += DETACH_STRIDE) {
      const kind = records[o]! as Kind;
      if (!(kind in FALL_PARAMS)) continue;
      const params = FALL_PARAMS[kind];
      // Tras un salto de años: lo ya descompuesto no aparece; lo reciente queda en el suelo.
      const at = records[o + 1]!;
      const age = nowYears - at;
      if (age >= params.decayYears) continue;
      const q0: Quat = [records[o + 5]!, records[o + 6]!, records[o + 7]!, records[o + 8]!];
      const p: Particle = {
        kind,
        position: [records[o + 2]!, records[o + 3]!, records[o + 4]!],
        velocity: [0, 0, 0],
        q0,
        q: [...q0],
        scale: records[o + 9]!,
        color: [records[o + 10]!, records[o + 11]!, records[o + 12]!],
        delay: Math.max(0, delayOf(records[o + 1]!)),
        phase: this.random() * Math.PI * 2,
        yaw: this.random() * Math.PI * 2,
        yawRate: (this.random() - 0.5) * 1.6,
        tumble: 0,
        tumbleRate: (this.random() - 0.5) * 2 * params.tumbleRate,
        landed: false,
        landedAtYears: 0,
        bounced: false,
      };
      p.phase = 0; // arranca sin cabeceo: continuidad con la pose en el árbol
      if (age > STALE_YEARS || falling >= this.options.maxFalling) {
        // Caída antigua o demasiadas en el aire: directamente al suelo, con su fecha.
        this.land(p, ground(p.position[0], p.position[2]), Math.min(at, nowYears));
      } else falling++;
      this.particles.push(p);
    }
    this.trimResting();
  }

  private land(p: Particle, groundY: number, nowYears: number): void {
    p.landed = true;
    p.landedAtYears = nowYears;
    p.position[1] = groundY + 0.0015 + 0.0005 * this.random();
    p.velocity = [0, 0, 0];
    p.q = restingQuat(p.q);
  }

  private trimResting(): void {
    let resting = 0;
    for (const p of this.particles) if (p.landed) resting++;
    if (resting <= this.options.maxResting) return;
    let excess = resting - this.options.maxResting;
    // Se retiran las más antiguas en el suelo.
    const order = this.particles
      .map((p, i) => ({ p, i }))
      .filter((x) => x.p.landed)
      .sort((a, b) => a.p.landedAtYears - b.p.landedAtYears);
    const drop = new Set<number>();
    for (const { i } of order) {
      if (excess-- <= 0) break;
      drop.add(i);
    }
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      if (!drop.has(i)) this.particles[w++] = this.particles[i]!;
    }
    this.particles.length = w;
  }

  /**
   * Avanza `dt` segundos reales. `tSeconds` es el reloj de presentación (para el viento)
   * y `nowYears` el tiempo simulado (para la descomposición en el suelo).
   */
  step(
    dt: number,
    tSeconds: number,
    nowYears: number,
    wind: WindSettings,
    seed: number,
    ground: Ground,
  ): void {
    const h = Math.min(dt, 0.05);
    const sub = Math.max(1, Math.ceil(h / (1 / 120)));
    const d = h / sub;
    let w = 0;
    for (const p of this.particles) {
      if (p.landed) {
        if ((nowYears - p.landedAtYears) / FALL_PARAMS[p.kind].decayYears >= 1) continue;
        this.particles[w++] = p;
        continue;
      }
      if (p.delay > 0) {
        p.delay -= h;
        this.particles[w++] = p;
        continue;
      }
      for (let k = 0; k < sub; k++) {
        this.integrate(p, d, tSeconds + k * d, nowYears, wind, seed, ground);
        if (p.landed) break;
      }
      this.particles[w++] = p;
    }
    this.particles.length = w;
  }

  private integrate(
    p: Particle,
    dt: number,
    t: number,
    nowYears: number,
    wind: WindSettings,
    seed: number,
    ground: Ground,
  ): void {
    const params = FALL_PARAMS[p.kind];
    const k = G / params.terminalVelocity;
    const air = windVelocityAt(wind, seed, t, p.position);
    p.phase += 2 * Math.PI * params.flutterHz * dt;
    p.yaw += p.yawRate * dt;
    p.tumble += p.tumbleRate * dt;
    const swing = Math.sin(p.phase);
    const side: V3 = [Math.cos(p.yaw), 0, Math.sin(p.yaw)];
    const a: V3 = [
      k * (air[0] - p.velocity[0]) + params.flutterAccel * swing * side[0],
      -G + k * (air[1] - p.velocity[1]) + 0.35 * params.flutterAccel * Math.abs(swing),
      k * (air[2] - p.velocity[2]) + params.flutterAccel * swing * side[2],
    ];
    // Semi-implícito: estable aunque k·dt sea grande (velocidad relajada hacia el aire).
    const relax = 1 / (1 + k * dt);
    for (let i = 0; i < 3; i++) {
      p.velocity[i] = (p.velocity[i]! + (a[i]! + k * p.velocity[i]!) * dt) * relax;
      p.position[i] = p.position[i]! + p.velocity[i]! * dt;
    }
    // Orientación: giro del plano de balanceo, cabeceo con el vaivén y volteo.
    const tilt = params.tiltAmp * swing + p.tumble;
    const qYaw = quatAxisAngle([0, 1, 0], p.yaw);
    const qTilt = quatAxisAngle([1, 0, 0], tilt);
    p.q = quatMul(quatMul(qYaw, qTilt), p.q0);

    const g = ground(p.position[0], p.position[2]);
    if (p.position[1] <= g) {
      const vy = p.velocity[1];
      if (params.restitution > 0 && !p.bounced && vy < -0.6) {
        p.bounced = true;
        p.position[1] = g;
        p.velocity = [p.velocity[0] * 0.4, -vy * params.restitution, p.velocity[2] * 0.4];
        return;
      }
      this.land(p, g, nowYears);
    }
  }

  /** Recorre las partículas de un tipo con su aspecto (escala y color) del instante. */
  forEach(
    kind: Kind,
    nowYears: number,
    visit: (position: V3, q: Quat, scale: number, color: V3) => void,
  ): void {
    for (const p of this.particles) {
      if (p.kind !== kind) continue;
      if (!p.landed) {
        visit(p.position, p.q, p.scale, p.color);
        continue;
      }
      // Descomposición: oscurece hacia el sustrato, encoge y se hunde un poco.
      const d = Math.max(
        0,
        Math.min(1, (nowYears - p.landedAtYears) / FALL_PARAMS[kind].decayYears),
      );
      const c: V3 = [
        p.color[0] + (SOIL[0] - p.color[0]) * d,
        p.color[1] + (SOIL[1] - p.color[1]) * d,
        p.color[2] + (SOIL[2] - p.color[2]) * d,
      ];
      const pos: V3 = [p.position[0], p.position[1] - 0.002 * d, p.position[2]];
      visit(pos, p.q, p.scale * (1 - 0.6 * d * d), c);
    }
  }
}
