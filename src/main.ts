import * as THREE from 'three/webgpu';
import { BranchRig } from './fx/rig.ts';
import { BarkView } from './render/bark.ts';
import { createPost } from './render/post.ts';
import { FoliageView } from './render/foliage.ts';
import { groundHeightLocal } from './render/pot.ts';
import { createRenderer } from './render/renderer.ts';
import { createStage } from './render/scene.ts';
import { SkeletonView } from './render/skeleton.ts';
import { showBackendStatus } from './ui/backend-banner.ts';
import { ControlPanel } from './ui/controls.ts';
import { FpsCounter } from './ui/fps.ts';
import type { RenderSnapshot } from './sim/snapshot.ts';
import type { FromWorker, ToWorker } from './worker/protocol.ts';
import type { StageHandle } from './render/scene.ts';

/**
 * Arrastre de ramas con el ratón (5.5): se agarra el nudo de la corteza bajo el puntero y
 * se tira de él en el plano perpendicular a la cámara. La órbita se suspende mientras dura.
 */
function setupBranchDragging(
  renderer: THREE.WebGPURenderer,
  stage: StageHandle,
  treeRoot: THREE.Group,
  bark: BarkView,
  rig: BranchRig,
): void {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const plane = new THREE.Plane();
  const hit = new THREE.Vector3();
  const el = renderer.domElement;
  const toPointer = (e: PointerEvent): void => {
    const r = el.getBoundingClientRect();
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, stage.camera);
  };
  el.addEventListener('pointerdown', (e) => {
    if (!rig.rig || e.button !== 0) return;
    toPointer(e);
    const [first] = raycaster.intersectObject(bark.object, false);
    if (!first?.face) return;
    const node = rig.rig.vertexNode[first.face.a];
    if (node === undefined) return;
    const axis = rig.nodeAxis[node]!;
    const rest: [number, number, number] = [
      rig.rig.nodeRest[node * 3]!,
      rig.rig.nodeRest[node * 3 + 1]!,
      rig.rig.nodeRest[node * 3 + 2]!,
    ];
    const local = treeRoot.worldToLocal(first.point.clone());
    rig.grab = { axis, node, restPoint: rest, target: [local.x, local.y, local.z] };
    plane.setFromNormalAndCoplanarPoint(
      stage.camera.getWorldDirection(new THREE.Vector3()).negate(),
      first.point,
    );
    stage.controls.enabled = false;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
  });
  el.addEventListener('pointermove', (e) => {
    if (!rig.grab) {
      // Indica qué se puede agarrar.
      if (!rig.rig) return;
      toPointer(e);
      el.style.cursor = raycaster.intersectObject(bark.object, false).length > 0 ? 'grab' : '';
      return;
    }
    toPointer(e);
    if (raycaster.ray.intersectPlane(plane, hit)) {
      const local = treeRoot.worldToLocal(hit.clone());
      rig.grab.target = [local.x, local.y, local.z];
    }
  });
  const release = (e: PointerEvent): void => {
    if (!rig.grab) return;
    rig.grab = null;
    stage.controls.enabled = true;
    el.style.cursor = '';
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Falta el contenedor #app');

  const params = new URLSearchParams(window.location.search);
  const wantsPost = params.get('post') !== '0' && params.get('backend') !== 'webgl';
  const { renderer, status } = await createRenderer(container, {
    forceWebGL: params.get('backend') === 'webgl',
    // Con postprocesado el lienzo va sin MSAA (GTAO necesita profundidad simple; FXAA suaviza).
    antialias: !wantsPost,
  });
  showBackendStatus(status);
  if (status.kind === 'none') return;

  const stage = createStage(renderer);
  // Postprocesado (AO) solo con WebGPU; `?post=0` lo desactiva.
  const post =
    status.kind === 'webgpu' && wantsPost
      ? createPost(renderer, stage.scene, stage.camera)
      : { render: () => renderer.render(stage.scene, stage.camera), setEnabled: () => {} };
  const resize = (): void => {
    const { clientWidth: w, clientHeight: h } = container;
    renderer.setSize(w, h);
    stage.resize(w, h);
  };
  window.addEventListener('resize', resize);
  resize();

  // El árbol nace en el punto de plantación del sustrato.
  const treeRoot = new THREE.Group();
  treeRoot.position.copy(stage.plantingPoint);
  stage.scene.add(treeRoot);
  // Corteza continua; `?skeleton=1` muestra la vista de diagnóstico con cilindros.
  const showSkeleton = params.get('skeleton') === '1';
  const skeleton = new SkeletonView();
  const bark = new BarkView();
  treeRoot.add(showSkeleton ? skeleton.object : bark.object);
  const foliage = new FoliageView(groundHeightLocal());
  treeRoot.add(foliage.object);
  const clock = new THREE.Timer();
  // Rig de ramas de presentación (fase 5): viento, peso y ratón; no toca la biología.
  const rig = new BranchRig();
  let latest: RenderSnapshot | null = null;
  setupBranchDragging(renderer, stage, treeRoot, bark, rig);

  const worker = new Worker(new URL('./worker/simulation.worker.ts', import.meta.url), {
    type: 'module',
  });
  const send = (msg: ToWorker): void => worker.postMessage(msg);

  const panel = new ControlPanel({
    onReset: (speciesId, seed) => send({ type: 'reset', speciesId, seed }),
    onPlay: (yearsPerSecond) => send({ type: 'play', yearsPerSecond }),
    onPause: () => send({ type: 'pause' }),
    onWind: (wind) => send({ type: 'wind', wind }),
    onHaze: (haze) => stage.setHaze(haze),
    onLeafCycle: (mode, yearsPerSecond) => send({ type: 'leafCycle', mode, yearsPerSecond }),
  });

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const msg = event.data;
    if (msg.type === 'error') {
      console.error('[Silvum] Worker:', msg.message);
      return;
    }
    if (msg.type === 'foliage') {
      foliage.updateLeaves(
        msg.flowers,
        msg.leaves,
        msg.detachments,
        msg.clockYears,
        performance.now() / 1000,
      );
      stage.setSeason(msg.phase);
      panel.updateFoliage(msg.phase, msg.leaves.count);
      return;
    }
    if (showSkeleton) {
      const previous = skeleton.object;
      const replaced = skeleton.update(msg.snapshot);
      if (replaced) {
        treeRoot.remove(previous);
        previous.dispose();
        treeRoot.add(replaced);
      }
    } else {
      bark.update(msg.snapshot.bark);
      rig.load(msg.snapshot.bark.rig);
      rig.deform();
      bark.applyRig(rig);
      foliage.applyRig(rig);
    }
    latest = msg.snapshot;
    foliage.update(msg.snapshot, performance.now() / 1000);
    panel.update(msg.snapshot);
    stage.setSeason(msg.snapshot.foliagePhase);
  };

  // Atajo de depuración: `?years=N` avanza N años al arrancar.
  const years = Number(params.get('years'));
  if (years > 0) send({ type: 'advance', years });

  const fps = new FpsCounter();
  renderer.setAnimationLoop((time) => {
    fps.tick();
    clock.update(time);
    if (latest && !showSkeleton) {
      rig.step(
        Math.min(clock.getDelta(), 0.05),
        performance.now() / 1000,
        latest.wind,
        latest.seed,
      );
      if (rig.moving) {
        rig.deform();
        bark.applyRig(rig);
        foliage.applyRig(rig);
      }
    }
    foliage.frame(clock.getDelta(), performance.now() / 1000);
    stage.update();
    post.render();
  });
}

void main();
