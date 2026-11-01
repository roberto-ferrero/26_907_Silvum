import * as THREE from 'three/webgpu';
import { FallingOrgans, type Ground } from '../fx/falling.ts';
import type { BranchRig } from '../fx/rig.ts';
import { DETACH_KIND } from '../sim/organs.ts';
import type { OrganBuffers, RenderSnapshot } from '../sim/snapshot.ts';
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
  /** Últimos búferes recibidos (en reposo), para volver a posarlos con el rig. */
  private leafBuffers: OrganBuffers | null = null;
  private flowerBuffers: OrganBuffers | null = null;
  private rig: BranchRig | null = null;
  private individual = '';
  private lastArrivalS = 0;
  /** Último instante del reloj de partículas recibido (ver `RenderSnapshot.clockYears`). */
  private clockYears = 0;

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
    const rewound = snapshot.clockYears < this.clockYears;
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
    this.leafBuffers = snapshot.leaves;
    this.flowerBuffers = snapshot.flowers;
    this.latest = snapshot;
    this.pose();
    if (rewound) this.clockYears = snapshot.clockYears;
    this.spawn(snapshot.detachments, snapshot.clockYears, nowS);
    this.latest = snapshot;
  }

  /** Actualización del ciclo de hojas independiente: solo hojas y sus caídas. */
  updateLeaves(
    flowers: OrganBuffers,
    leaves: OrganBuffers,
    detachments: Float32Array,
    clockYears: number,
    nowS: number,
  ): void {
    if (!this.latest) return;
    this.leafBuffers = leaves;
    this.flowerBuffers = flowers;
    this.leaves.update(leaves, this.rig ?? undefined);
    this.flowers.update(flowers, this.rig ?? undefined);
    this.spawn(detachments, clockYears, nowS);
  }

  /** Vuelve a posar hojas, flores y frutos (tras moverse el rig o llegar datos). */
  applyRig(rig: BranchRig): void {
    this.rig = rig;
    this.pose();
  }

  private pose(): void {
    const s = this.latest;
    if (!s) return;
    const rig = this.rig ?? undefined;
    if (this.leafBuffers) this.leaves.update(this.leafBuffers, rig);
    if (this.flowerBuffers) this.flowers.update(this.flowerBuffers, rig);
    this.fruits.update(s.fruits, rig);
  }

  /** Reparte cada caída del lote en el tiempo real que ha durado (máx. 1,5 s). */
  private spawn(records: Float32Array, clockYears: number, nowS: number): void {
    const from = this.clockYears;
    const spanYears = Math.max(1e-6, clockYears - from);
    const spanS = Math.min(1.5, Math.max(0, nowS - this.lastArrivalS));
    this.falling.spawn(
      records,
      this.ground,
      clockYears,
      (t) => Math.max(0, Math.min(1, (t - from) / spanYears)) * spanS,
    );
    this.lastArrivalS = nowS;
    this.clockYears = Math.max(this.clockYears, clockYears);
  }

  /** Avanza las partículas un fotograma. */
  frame(dt: number, nowS: number): void {
    const s = this.latest;
    if (!s) return;
    const now = this.clockYears;
    this.falling.step(dt, nowS, now, s.wind, s.seed, this.ground);
    this.draw(this.fallenLeaves, DETACH_KIND.leaf, now);
    this.draw(this.petals, DETACH_KIND.petal, now);
    this.draw(this.fallenFruits, DETACH_KIND.fruit, now);
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
