/**
 * Rig de ramas de presentación (fases 5.1, 5.3-5.5): un muelle de flexión amortiguado por
 * eje, con la masa, la rigidez y el área foliar de su subárbol (`src/sim/mechanics.ts`).
 *
 *   I·θ'' = τ_peso + τ_viento + τ_ratón − k·θ − c·θ'
 *
 * θ es un vector de rotación en coordenadas del árbol (sin componente de torsión). La
 * flexión de un eje se reparte por igual entre sus nudos (viga uniformemente curvada) y se
 * hereda por los ejes hijos. Es solo dibujo: nada vuelve al estado biológico (5.7).
 * Sin three.js: se prueba en Node.
 */
import type { RigData } from '../sim/bark-mesh.ts';
import { MECH } from '../sim/mechanics.ts';
import { windVelocityAt, type WindSettings } from '../sim/wind.ts';
import { rotate, type V3 } from './falling.ts';

/** Fracción de la combadura por peso que se ve en vivo (el resto ya está en la forma). */
const LIVE_GRAVITY = 0.3;
/** Densidad del aire (kg/m³) y coeficiente de arrastre del follaje. */
const AIR_DENSITY = 1.2;
const DRAG = 1.0;
/** Flexión máxima por eje (rad) y la parte que puede deberse al peso. */
const MAX_BEND = 0.6;
const MAX_GRAVITY_BEND = 0.08;

export interface Grab {
  axis: number;
  /** Punto agarrado en reposo y punto objetivo (coordenadas del árbol). */
  restPoint: V3;
  node: number;
  target: V3;
}

const crossV = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export class BranchRig {
  rig: RigData | null = null;
  /** Estado dinámico por eje: θ y θ' (3 floats cada uno). */
  private theta = new Float32Array(0);
  private omega = new Float32Array(0);
  /** Pose deformada por nudo: posición (3) y rotación (4). */
  nodePos = new Float32Array(0);
  nodeRot = new Float32Array(0);
  /** Matriz de rotación por nudo (9 floats), derivada de `nodeRot`. */
  private nodeMat = new Float32Array(0);
  private axisDir = new Float32Array(0);
  private segmentNode = new Map<number, number>();
  /** Eje al que pertenece cada nudo. */
  nodeAxis = new Int32Array(0);
  grab: Grab | null = null;
  /** Hay movimiento apreciable (si no, la pose no cambia y no hace falta redibujar). */
  moving = true;

  load(rig: RigData): void {
    const prev = new Map<number, number>();
    if (this.rig) this.rig.axisId.forEach((id, a) => prev.set(id, a));
    const axes = rig.axisId.length;
    const theta = new Float32Array(axes * 3);
    const omega = new Float32Array(axes * 3);
    const dir = new Float32Array(axes * 3);
    const nodeAxis = new Int32Array(rig.nodeSegment.length);
    for (let a = 0; a < axes; a++) {
      const old = prev.get(rig.axisId[a]!);
      if (old !== undefined) {
        theta.set(this.theta.subarray(old * 3, old * 3 + 3), a * 3);
        omega.set(this.omega.subarray(old * 3, old * 3 + 3), a * 3);
      }
      const n0 = rig.axisFirstNode[a]!;
      const n1 = n0 + 1;
      const d: V3 = [
        rig.nodeRest[n1 * 3]! - rig.nodeRest[n0 * 3]!,
        rig.nodeRest[n1 * 3 + 1]! - rig.nodeRest[n0 * 3 + 1]!,
        rig.nodeRest[n1 * 3 + 2]! - rig.nodeRest[n0 * 3 + 2]!,
      ];
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      dir.set([d[0] / len, d[1] / len, d[2] / len], a * 3);
      for (let k = 0; k < rig.axisNodeCount[a]!; k++) nodeAxis[n0 + k] = a;
    }
    this.segmentNode.clear();
    rig.nodeSegment.forEach((seg, node) => {
      if (seg >= 0) this.segmentNode.set(seg, node);
    });
    this.rig = rig;
    this.theta = theta;
    this.omega = omega;
    this.axisDir = dir;
    this.nodeAxis = nodeAxis;
    this.nodePos = new Float32Array(rig.nodeRest);
    this.nodeRot = new Float32Array(rig.nodeSegment.length * 4);
    this.nodeMat = new Float32Array(rig.nodeSegment.length * 9);
    for (let i = 0; i < rig.nodeSegment.length; i++) {
      this.nodeRot[i * 4 + 3] = 1;
      this.nodeMat[i * 9] = 1;
      this.nodeMat[i * 9 + 4] = 1;
      this.nodeMat[i * 9 + 8] = 1;
    }
    this.grab = null;
    this.moving = true;
  }

  /** Nudo en el que termina un entrenudo (donde cuelgan sus hojas y frutos). */
  nodeOfSegment(segmentId: number): number | undefined {
    return this.segmentNode.get(segmentId);
  }

  private pivot(a: number): V3 {
    const r = this.rig!;
    const n = r.axisFirstNode[a]! * 3;
    return [r.nodeRest[n]!, r.nodeRest[n + 1]!, r.nodeRest[n + 2]!];
  }

  /** Avanza la dinámica `dt` segundos reales. */
  step(dt: number, tSeconds: number, wind: WindSettings, seed: number): void {
    const r = this.rig;
    if (!r) return;
    const axes = r.axisId.length;
    const torque = new Float32Array(axes * 3);
    for (let a = 0; a < axes; a++) {
      const pivot = this.pivot(a);
      const com: V3 = [r.axisCom[a * 3]!, r.axisCom[a * 3 + 1]!, r.axisCom[a * 3 + 2]!];
      const lever: V3 = [com[0] - pivot[0], com[1] - pivot[1], com[2] - pivot[2]];
      const mass = r.axisMassKg[a]!;
      let tau = crossV(lever, [0, -mass * MECH.gravity * LIVE_GRAVITY, 0]);
      // La combadura viva por peso se acota (la forma ya incorpora la memoria lenta).
      const gravityBend = Math.hypot(tau[0], tau[1], tau[2]) / r.axisStiffness[a]!;
      if (gravityBend > MAX_GRAVITY_BEND) {
        const f = MAX_GRAVITY_BEND / gravityBend;
        tau = [tau[0] * f, tau[1] * f, tau[2] * f];
      }
      const area = r.axisLeafAreaM2[a]!;
      if (area > 0 && wind.intensity01 > 0) {
        const w = windVelocityAt(wind, seed, tSeconds, com);
        const speed = Math.hypot(w[0], w[1], w[2]);
        const q = 0.5 * AIR_DENSITY * DRAG * area * speed;
        const tw = crossV(lever, [q * w[0], q * w[1], q * w[2]]);
        tau = [tau[0] + tw[0], tau[1] + tw[1], tau[2] + tw[2]];
      }
      torque.set(tau, a * 3);
    }
    // Ratón: fuerza de muelle hacia el objetivo en el eje agarrado y, atenuada, en sus
    // portadores (la rama tira de la rama madre).
    if (this.grab) {
      const g = this.grab;
      const p = this.deformedPoint(g.node, g.restPoint);
      const k = r.axisStiffness[g.axis]!;
      const pivot = this.pivot(g.axis);
      const reach = Math.max(Math.hypot(p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]), 0.02);
      const gain = (2 * k) / (reach * reach);
      const f: V3 = [
        gain * (g.target[0] - p[0]),
        gain * (g.target[1] - p[1]),
        gain * (g.target[2] - p[2]),
      ];
      let a = g.axis;
      let atten = 1;
      while (a >= 0 && atten > 0.05) {
        const pv = this.pivot(a);
        const t = crossV([p[0] - pv[0], p[1] - pv[1], p[2] - pv[2]], f);
        for (let i = 0; i < 3; i++) torque[a * 3 + i] = torque[a * 3 + i]! + t[i]! * atten;
        const parentNode = r.axisParentNode[a]!;
        a = parentNode >= 0 ? this.nodeAxis[parentNode]! : -1;
        atten *= 0.5;
      }
    }
    let maxSpeed = 0;
    for (let a = 0; a < axes; a++) {
      const k = r.axisStiffness[a]!;
      const I = r.axisInertia[a]!;
      const c = r.axisDamping[a]!;
      const d: V3 = [this.axisDir[a * 3]!, this.axisDir[a * 3 + 1]!, this.axisDir[a * 3 + 2]!];
      // Sin torsión: se quita la componente a lo largo del eje.
      let tau: V3 = [torque[a * 3]!, torque[a * 3 + 1]!, torque[a * 3 + 2]!];
      const along = tau[0] * d[0] + tau[1] * d[1] + tau[2] * d[2];
      tau = [tau[0] - along * d[0], tau[1] - along * d[1], tau[2] - along * d[2]];
      const wn = Math.sqrt(k / I);
      const sub = Math.max(1, Math.ceil((dt * wn) / 0.25));
      const h = dt / sub;
      for (let s = 0; s < sub; s++) {
        for (let i = 0; i < 3; i++) {
          const o = a * 3 + i;
          const acc = (tau[i]! - k * this.theta[o]! - c * this.omega[o]!) / I;
          this.omega[o] = this.omega[o]! + acc * h;
          this.theta[o] = this.theta[o]! + this.omega[o]! * h;
        }
      }
      const mag = Math.hypot(this.theta[a * 3]!, this.theta[a * 3 + 1]!, this.theta[a * 3 + 2]!);
      if (mag > MAX_BEND) {
        // Tope: se queda en el límite sin rebotar contra él.
        for (let i = 0; i < 3; i++) {
          this.theta[a * 3 + i] = (this.theta[a * 3 + i]! * MAX_BEND) / mag;
          this.omega[a * 3 + i] = 0;
        }
      }
      maxSpeed = Math.max(
        maxSpeed,
        Math.hypot(this.omega[a * 3]!, this.omega[a * 3 + 1]!, this.omega[a * 3 + 2]!),
      );
    }
    this.moving = maxSpeed > 1e-4 || this.grab !== null || wind.intensity01 > 0;
  }

  /**
   * Recalcula la pose de todos los nudos (ejes en orden: padre antes que hijos). Corre en
   * cada fotograma con viento: sin reservas de memoria y con una matriz por nudo.
   */
  deform(): void {
    const r = this.rig;
    if (!r) return;
    const rest = r.nodeRest;
    const pos = this.nodePos;
    const rot = this.nodeRot;
    const mat = this.nodeMat;
    for (let a = 0; a < r.axisId.length; a++) {
      const first = r.axisFirstNode[a]!;
      const count = r.axisNodeCount[a]!;
      const parent = r.axisParentNode[a]!;
      let qx = 0;
      let qy = 0;
      let qz = 0;
      let qw = 1;
      let px = rest[first * 3]!;
      let py = rest[first * 3 + 1]!;
      let pz = rest[first * 3 + 2]!;
      if (parent >= 0) {
        qx = rot[parent * 4]!;
        qy = rot[parent * 4 + 1]!;
        qz = rot[parent * 4 + 2]!;
        qw = rot[parent * 4 + 3]!;
        const m = parent * 9;
        const ex = px - rest[parent * 3]!;
        const ey = py - rest[parent * 3 + 1]!;
        const ez = pz - rest[parent * 3 + 2]!;
        px = pos[parent * 3]! + mat[m]! * ex + mat[m + 1]! * ey + mat[m + 2]! * ez;
        py = pos[parent * 3 + 1]! + mat[m + 3]! * ex + mat[m + 4]! * ey + mat[m + 5]! * ez;
        pz = pos[parent * 3 + 2]! + mat[m + 6]! * ex + mat[m + 7]! * ey + mat[m + 8]! * ez;
      }
      // Giro incremental por entrenudo: la flexión del eje repartida entre sus nudos.
      const segs = Math.max(1, count - 1);
      const tx = this.theta[a * 3]! / segs;
      const ty = this.theta[a * 3 + 1]! / segs;
      const tz = this.theta[a * 3 + 2]! / segs;
      const angle = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const sinc = angle < 1e-9 ? 0.5 : Math.sin(angle / 2) / angle;
      const dx = tx * sinc;
      const dy = ty * sinc;
      const dz = tz * sinc;
      const dw = Math.cos(angle / 2);
      for (let j = 0; j < count; j++) {
        const n = first + j;
        if (j > 0) {
          const nx = dw * qx + dx * qw + dy * qz - dz * qy;
          const ny = dw * qy - dx * qz + dy * qw + dz * qx;
          const nz = dw * qz + dx * qy - dy * qx + dz * qw;
          const nw = dw * qw - dx * qx - dy * qy - dz * qz;
          qx = nx;
          qy = ny;
          qz = nz;
          qw = nw;
        }
        const xx = qx * qx;
        const yy = qy * qy;
        const zz = qz * qz;
        const xy = qx * qy;
        const xz = qx * qz;
        const yz = qy * qz;
        const wx = qw * qx;
        const wy = qw * qy;
        const wz = qw * qz;
        const m = n * 9;
        mat[m] = 1 - 2 * (yy + zz);
        mat[m + 1] = 2 * (xy - wz);
        mat[m + 2] = 2 * (xz + wy);
        mat[m + 3] = 2 * (xy + wz);
        mat[m + 4] = 1 - 2 * (xx + zz);
        mat[m + 5] = 2 * (yz - wx);
        mat[m + 6] = 2 * (xz - wy);
        mat[m + 7] = 2 * (yz + wx);
        mat[m + 8] = 1 - 2 * (xx + yy);
        if (j > 0) {
          const ex = rest[n * 3]! - rest[(n - 1) * 3]!;
          const ey = rest[n * 3 + 1]! - rest[(n - 1) * 3 + 1]!;
          const ez = rest[n * 3 + 2]! - rest[(n - 1) * 3 + 2]!;
          px += mat[m]! * ex + mat[m + 1]! * ey + mat[m + 2]! * ez;
          py += mat[m + 3]! * ex + mat[m + 4]! * ey + mat[m + 5]! * ez;
          pz += mat[m + 6]! * ex + mat[m + 7]! * ey + mat[m + 8]! * ez;
        }
        pos[n * 3] = px;
        pos[n * 3 + 1] = py;
        pos[n * 3 + 2] = pz;
        rot[n * 4] = qx;
        rot[n * 4 + 1] = qy;
        rot[n * 4 + 2] = qz;
        rot[n * 4 + 3] = qw;
      }
    }
  }

  /** Punto de reposo `restPoint` unido al nudo `node`, en su posición deformada. */
  deformedPoint(node: number, restPoint: V3): V3 {
    const r = this.rig!;
    const q = this.nodeRot.subarray(node * 4, node * 4 + 4);
    const off = rotate(
      [q[0]!, q[1]!, q[2]!, q[3]!],
      [
        restPoint[0] - r.nodeRest[node * 3]!,
        restPoint[1] - r.nodeRest[node * 3 + 1]!,
        restPoint[2] - r.nodeRest[node * 3 + 2]!,
      ],
    );
    return [
      this.nodePos[node * 3]! + off[0],
      this.nodePos[node * 3 + 1]! + off[1],
      this.nodePos[node * 3 + 2]! + off[2],
    ];
  }

  /** Deforma una malla de corteza en reposo (posiciones y normales). */
  deformBark(
    restPos: Float32Array,
    restNrm: Float32Array,
    outPos: Float32Array,
    outNrm: Float32Array,
  ): void {
    const r = this.rig;
    if (!r) return;
    const vn = r.vertexNode;
    const rest = r.nodeRest;
    const pos = this.nodePos;
    const mat = this.nodeMat;
    for (let v = 0; v < vn.length; v++) {
      const n = vn[v]!;
      const m = n * 9;
      const o = v * 3;
      const m0 = mat[m]!;
      const m1 = mat[m + 1]!;
      const m2 = mat[m + 2]!;
      const m3 = mat[m + 3]!;
      const m4 = mat[m + 4]!;
      const m5 = mat[m + 5]!;
      const m6 = mat[m + 6]!;
      const m7 = mat[m + 7]!;
      const m8 = mat[m + 8]!;
      const dx = restPos[o]! - rest[n * 3]!;
      const dy = restPos[o + 1]! - rest[n * 3 + 1]!;
      const dz = restPos[o + 2]! - rest[n * 3 + 2]!;
      outPos[o] = pos[n * 3]! + m0 * dx + m1 * dy + m2 * dz;
      outPos[o + 1] = pos[n * 3 + 1]! + m3 * dx + m4 * dy + m5 * dz;
      outPos[o + 2] = pos[n * 3 + 2]! + m6 * dx + m7 * dy + m8 * dz;
      const nx = restNrm[o]!;
      const ny = restNrm[o + 1]!;
      const nz = restNrm[o + 2]!;
      outNrm[o] = m0 * nx + m1 * ny + m2 * nz;
      outNrm[o + 1] = m3 * nx + m4 * ny + m5 * nz;
      outNrm[o + 2] = m6 * nx + m7 * ny + m8 * nz;
    }
  }

  /**
   * Pose deformada de un órgano colgado del entrenudo `segmentId`: lee posición y
   * cuaternión de `data[o..o+6]` y los escribe en `out[0..6]`, sin reservar memoria.
   */
  poseOrgan(segmentId: number, data: Float32Array, o: number, out: Float32Array): void {
    const n = this.segmentNode.get(segmentId);
    const px = data[o]!;
    const py = data[o + 1]!;
    const pz = data[o + 2]!;
    const bx = data[o + 3]!;
    const by = data[o + 4]!;
    const bz = data[o + 5]!;
    const bw = data[o + 6]!;
    if (n === undefined) {
      out[0] = px;
      out[1] = py;
      out[2] = pz;
      out[3] = bx;
      out[4] = by;
      out[5] = bz;
      out[6] = bw;
      return;
    }
    const rest = this.rig!.nodeRest;
    const mat = this.nodeMat;
    const m = n * 9;
    const dx = px - rest[n * 3]!;
    const dy = py - rest[n * 3 + 1]!;
    const dz = pz - rest[n * 3 + 2]!;
    out[0] = this.nodePos[n * 3]! + mat[m]! * dx + mat[m + 1]! * dy + mat[m + 2]! * dz;
    out[1] = this.nodePos[n * 3 + 1]! + mat[m + 3]! * dx + mat[m + 4]! * dy + mat[m + 5]! * dz;
    out[2] = this.nodePos[n * 3 + 2]! + mat[m + 6]! * dx + mat[m + 7]! * dy + mat[m + 8]! * dz;
    const ax = this.nodeRot[n * 4]!;
    const ay = this.nodeRot[n * 4 + 1]!;
    const az = this.nodeRot[n * 4 + 2]!;
    const aw = this.nodeRot[n * 4 + 3]!;
    out[3] = aw * bx + ax * bw + ay * bz - az * by;
    out[4] = aw * by - ax * bz + ay * bw + az * bx;
    out[5] = aw * bz + ax * by - ay * bx + az * bw;
    out[6] = aw * bw - ax * bx - ay * by - az * bz;
  }

  /** Flexión actual de un eje (rad), para pruebas y diagnóstico. */
  bendOf(axisIndex: number): number {
    return Math.hypot(
      this.theta[axisIndex * 3]!,
      this.theta[axisIndex * 3 + 1]!,
      this.theta[axisIndex * 3 + 2]!,
    );
  }
}
