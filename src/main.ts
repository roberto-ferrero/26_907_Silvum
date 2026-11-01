import { createRenderer } from './render/renderer.ts';
import { createStage } from './render/scene.ts';
import { showBackendStatus } from './ui/backend-banner.ts';

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

  renderer.setAnimationLoop(() => {
    stage.update();
    renderer.render(stage.scene, stage.camera);
  });
}

void main();
