import * as THREE from 'three/webgpu';
import { FallingOrgans, type Ground } from '../fx/falling.ts';
import { DETACH_KIND } from '../sim/organs.ts';
import type { RenderSnapshot } from '../sim/snapshot.ts';
import { getSpecies } from '../sim/species.ts';
import {
  createFlowerGeometry,
  createFruitGeometry,
  createLeafClusterGeometry,
  createLeafGeometry,
  createPetalGeometry,
} from './organ-geometry.ts';
import { OrganView } from './organs.ts';

/**
 * Hojas, flores y frutos en el árbol, más los órganos que caen y los que quedan en el
 * suelo (fase 4). Todo en coordenadas del árbol (origen en el punto de plantación).
 */
export class FoliageView {
  readonly object = new THREE.Group();
  private readonly leaves = new OrganView('leaves', { roughness: 0.7 });
  private readonly flowers = new OrganView('flowers', { roughness: 0.6 });
  private readonly fruits = new OrganView('fruits', { roughness: 0.55, side: THREE.FrontSide });
  private readonly fallenLeaves = new OrganView('fallen-leaves', { roughness: 0.8 });
  private readonly petals = new OrganView('petals', { roughness: 0.6 });
  private readonly fallenFruits = new OrganView('fallen-fruits', {
    roughness: 0.6,
    side: THREE.FrontSide,
  });
  private readonly falling = new FallingOrgans();
  private latest: RenderSnapshot | null = null;
  private individual = '';
  private lastArrivalS = 0;
  private lastSnapshotYears = 0;

  constructor(private readonly ground: Ground) {
    this.object.name = 'foliage';
    this.petals.setGeometry('petal', createPetalGeometry);
    for (const v of [
      this.leaves,
      this.flowers,
      this.fruits,
      this.fallenLeaves,
      this.petals,
      this.fallenFruits,
    ]) {
      this.object.add(v.object);
    }
  }

  /** Nueva instantánea del Worker; `nowS` es el reloj de presentación. */
  update(snapshot: RenderSnapshot, nowS: number): void {
    const species = getSpecies(snapshot.speciesId);
    const key = `${snapshot.speciesId}:${snapshot.seed}`;
    const rewound = snapshot.timeYears < this.lastSnapshotYears;
    if (key !== this.individual || rewound) {
      // Otro árbol (o vuelta atrás): fuera las partículas del anterior.
      this.individual = key;
      this.falling.particles.length = 0;
      const cluster = species.leaves.clusterSize ?? 1;
      this.leaves.setGeometry(key, () => createLeafClusterGeometry(snapshot.leafForm, cluster));
      this.fallenLeaves.setGeometry(key, () => createLeafGeometry(snapshot.leafForm));
      if (species.flowering) {
        const program = species.flowering;
        this.flowers.setGeometry(snapshot.speciesId, () => createFlowerGeometry(program));
      }
      if (species.fruiting) {
        const program = species.fruiting;
        this.fruits.setGeometry(snapshot.speciesId, () => createFruitGeometry(program));
        this.fallenFruits.setGeometry(snapshot.speciesId, () => createFruitGeometry(program));
      }
    }
    this.leaves.update(snapshot.leaves);
    this.flowers.update(snapshot.flowers);
    this.fruits.update(snapshot.fruits);

    // Reparte cada caída del lote en el tiempo real que ha durado (máx. 1,5 s).
    const spanYears = Math.max(1e-6, snapshot.timeYears - this.lastSnapshotYears);
    const spanS = Math.min(1.5, Math.max(0, nowS - this.lastArrivalS));
    const from = this.lastSnapshotYears;
    this.falling.spawn(snapshot.detachments, this.ground, snapshot.timeYears, (t) =>
      rewound ? 0 : Math.max(0, Math.min(1, (t - from) / spanYears)) * spanS,
    );
    this.lastArrivalS = nowS;
    this.lastSnapshotYears = snapshot.timeYears;
    this.latest = snapshot;
  }

  /** Avanza las partículas un fotograma. */
  frame(dt: number, nowS: number): void {
    const s = this.latest;
    if (!s) return;
    this.falling.step(dt, nowS, s.timeYears, s.wind, s.seed, this.ground);
    this.draw(this.fallenLeaves, DETACH_KIND.leaf, s.timeYears);
    this.draw(this.petals, DETACH_KIND.petal, s.timeYears);
    this.draw(this.fallenFruits, DETACH_KIND.fruit, s.timeYears);
  }

  private draw(view: OrganView, kind: number, nowYears: number): void {
    const items: Parameters<Parameters<FallingOrgans['forEach']>[2]>[] = [];
    this.falling.forEach(kind as 0, nowYears, (p, q, scale, color) =>
      items.push([p, q, scale, color]),
    );
    view.write(items.length, (i, out) => {
      const [p, q, scale, color] = items[i]!;
      out.position.set(p[0], p[1], p[2]);
      out.quaternion.set(q[0], q[1], q[2], q[3]);
      out.scale = scale;
      out.color[0] = color[0];
      out.color[1] = color[1];
      out.color[2] = color[2];
    });
  }

  get particleCount(): number {
    return this.falling.particles.length;
  }
}
