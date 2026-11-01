import { describe, expect, it } from 'vitest';
import { BranchRig } from '../src/fx/rig.ts';
import { buildBarkMesh } from '../src/sim/bark-mesh.ts';
import { TreeSimulation } from '../src/sim/tree.ts';
import { CALM } from '../src/sim/wind.ts';

function makeRig(): { rig: BranchRig; sim: TreeSimulation } {
  const sim = new TreeSimulation({ speciesId: 'quercus-robur', seed: 9 });
  sim.advanceYears(20.55);
  const rig = new BranchRig();
  rig.load(buildBarkMesh(sim.state).rig);
  return { rig, sim };
}

/** Desplazamiento máximo de los nudos respecto a su reposo (m). */
function maxDisplacement(rig: BranchRig): number {
  const r = rig.rig!;
  let max = 0;
  for (let i = 0; i < r.nodeRest.length; i += 3) {
    const d = Math.hypot(
      rig.nodePos[i]! - r.nodeRest[i]!,
      rig.nodePos[i + 1]! - r.nodeRest[i + 1]!,
      rig.nodePos[i + 2]! - r.nodeRest[i + 2]!,
    );
    max = Math.max(max, d);
  }
  return max;
}

describe('rig de ramas', () => {
  it('en calma solo se comba un poco por el peso y se detiene', () => {
    const { rig } = makeRig();
    for (let i = 0; i < 600; i++) rig.step(1 / 60, i / 60, CALM, 1);
    rig.deform();
    expect(rig.moving).toBe(false);
    expect(maxDisplacement(rig)).toBeLessThan(0.05);
  });

  it('el viento mece las ramas y la pose cambia con el tiempo', () => {
    const { rig } = makeRig();
    const wind = { intensity01: 1, directionRad: 0 };
    const samples: number[] = [];
    for (let i = 0; i < 300; i++) {
      rig.step(1 / 60, i / 60, wind, 1);
      if (i % 20 === 0) {
        rig.deform();
        samples.push(maxDisplacement(rig));
      }
    }
    expect(rig.moving).toBe(true);
    expect(Math.max(...samples)).toBeGreaterThan(0.01);
    expect(new Set(samples.map((x) => x.toFixed(4))).size).toBeGreaterThan(3);
    expect(rig.nodePos.every(Number.isFinite)).toBe(true);
  });

  it('el ratón arrastra la rama agarrada hacia el puntero', () => {
    const { rig } = makeRig();
    const r = rig.rig!;
    // Una rama con varios nudos: se agarra su punta.
    let axis = 0;
    for (let a = 0; a < r.axisId.length; a++) if (r.axisNodeCount[a]! > 6 && a > 0) axis = a;
    const node = r.axisFirstNode[axis]! + r.axisNodeCount[axis]! - 1;
    const rest: [number, number, number] = [
      r.nodeRest[node * 3]!,
      r.nodeRest[node * 3 + 1]!,
      r.nodeRest[node * 3 + 2]!,
    ];
    // Se tira en horizontal, perpendicular a la rama (tirar a lo largo no la flexiona).
    const n0 = r.axisFirstNode[axis]!;
    const d = [rest[0] - r.nodeRest[n0 * 3]!, 0, rest[2] - r.nodeRest[n0 * 3 + 2]!];
    const len = Math.hypot(d[0]!, d[2]!) || 1;
    const side: [number, number, number] = [-d[2]! / len, 0, d[0]! / len];
    const target: [number, number, number] = [
      rest[0] + side[0] * 0.08,
      rest[1],
      rest[2] + side[2] * 0.08,
    ];
    rig.grab = { axis, node, restPoint: rest, target };
    for (let i = 0; i < 240; i++) rig.step(1 / 60, i / 60, CALM, 1);
    rig.deform();
    const p = rig.deformedPoint(node, rest);
    const moved = (p[0] - rest[0]) * side[0] + (p[2] - rest[2]) * side[2];
    expect(moved).toBeGreaterThan(0.02);
  });

  it('no modifica el estado biológico (5.7)', () => {
    const { rig, sim } = makeRig();
    const before = JSON.stringify(sim.state);
    for (let i = 0; i < 60; i++) rig.step(1 / 60, i / 60, { intensity01: 1, directionRad: 1 }, 2);
    rig.deform();
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it('un fotograma (dinámica + pose de la corteza) cabe en pocos ms', () => {
    const sim = new TreeSimulation({ speciesId: 'quercus-robur', seed: 9 });
    sim.advanceYears(40.55);
    const mesh = buildBarkMesh(sim.state);
    const rig = new BranchRig();
    rig.load(mesh.rig);
    const pos = new Float32Array(mesh.positions.length);
    const nrm = new Float32Array(mesh.normals.length);
    const wind = { intensity01: 0.7, directionRad: 0 };
    const start = performance.now();
    for (let i = 0; i < 30; i++) {
      rig.step(1 / 60, i / 60, wind, 1);
      rig.deform();
      rig.deformBark(mesh.positions, mesh.normals, pos, nrm);
    }
    // Holgura amplia (los tests corren en paralelo y en la CI): ~10-20 ms en solitario;
    // solo detecta regresiones grandes.
    expect((performance.now() - start) / 30).toBeLessThan(150);
  }, 60000);
});
