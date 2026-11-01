import * as THREE from 'three/webgpu';
import { FoliageView } from './render/foliage.ts';
import { groundHeightLocal } from './render/pot.ts';
import { createRenderer } from './render/renderer.ts';
import { createStage } from './render/scene.ts';
import { SkeletonView } from './render/skeleton.ts';
import { showBackendStatus } from './ui/backend-banner.ts';
import { ControlPanel } from './ui/controls.ts';
import type { FromWorker, ToWorker } from './worker/protocol.ts';

async function main(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) throw new Error('Falta el contenedor #app');

  const params = new URLSearchParams(window.location.search);
  const { renderer, status } = await createRenderer(container, {
    forceWebGL: params.get('backend') === 'webgl',
  });
  showBackendStatus(status);
  if (status.kind === 'none') return;

  const stage = createStage(renderer);
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
  const skeleton = new SkeletonView();
  treeRoot.add(skeleton.object);
  const foliage = new FoliageView(groundHeightLocal());
  treeRoot.add(foliage.object);
  const clock = new THREE.Timer();

  const worker = new Worker(new URL('./worker/simulation.worker.ts', import.meta.url), {
    type: 'module',
  });
  const send = (msg: ToWorker): void => worker.postMessage(msg);

  const panel = new ControlPanel({
    onReset: (speciesId, seed) => send({ type: 'reset', speciesId, seed }),
    onPlay: (yearsPerSecond) => send({ type: 'play', yearsPerSecond }),
    onPause: () => send({ type: 'pause' }),
    onWind: (wind) => send({ type: 'wind', wind }),
  });

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const msg = event.data;
    if (msg.type === 'error') {
      console.error('[Silvum] Worker:', msg.message);
      return;
    }
    const previous = skeleton.object;
    const replaced = skeleton.update(msg.snapshot);
    if (replaced) {
      treeRoot.remove(previous);
      previous.dispose();
      treeRoot.add(replaced);
    }
    foliage.update(msg.snapshot, performance.now() / 1000);
    panel.update(msg.snapshot);
  };

  // Atajo de depuración: `?years=N` avanza N años al arrancar.
  const years = Number(params.get('years'));
  if (years > 0) send({ type: 'advance', years });

  renderer.setAnimationLoop((time) => {
    clock.update(time);
    foliage.frame(clock.getDelta(), performance.now() / 1000);
    stage.update();
    renderer.render(stage.scene, stage.camera);
  });
}

void main();
