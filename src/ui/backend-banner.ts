import type { BackendStatus } from '../render/backend.ts';

/** Muestra un aviso cuando no hay WebGPU y una etiqueta discreta con el backend. */
export function showBackendStatus(status: BackendStatus): void {
  if (status.level !== 'ok') {
    const banner = document.createElement('div');
    banner.className = 'backend-banner';
    banner.dataset['level'] = status.level;
    banner.setAttribute('role', 'status');
    banner.textContent = status.message;
    document.body.appendChild(banner);
  }
  const badge = document.createElement('div');
  badge.className = 'backend-badge';
  badge.textContent =
    status.kind === 'webgpu' ? 'WebGPU' : status.kind === 'webgl2' ? 'WebGL 2' : '';
  document.body.appendChild(badge);
}
