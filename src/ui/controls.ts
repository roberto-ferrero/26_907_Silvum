import { listArchetypes } from '../sim/morphotype.ts';
import type { RenderSnapshot } from '../sim/snapshot.ts';

export interface ControlHandlers {
  onReset(archetypeId: string, seed: number): void;
  onPlay(yearsPerSecond: number): void;
  onPause(): void;
}

/** Panel mínimo (fase 2): arquetipo, semilla, reproducir, velocidad y estado. */
export class ControlPanel {
  private readonly info: HTMLElement;
  private playing = false;

  constructor(private readonly handlers: ControlHandlers) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    const options = listArchetypes()
      .map((a) => `<option value="${a.id}">${a.name}</option>`)
      .join('');
    panel.innerHTML = `
      <label>Arquetipo <select data-k="archetype">${options}</select></label>
      <label>Semilla <input data-k="seed" type="number" min="0" max="4294967295" value="7" /></label>
      <div class="row">
        <button data-k="play" type="button">Reproducir</button>
        <button data-k="reset" type="button">Reiniciar</button>
      </div>
      <label>Velocidad <span data-k="speedLabel">1 año/s</span>
        <input data-k="speed" type="range" min="-2" max="2.3" step="0.1" value="0" />
      </label>
      <div class="info" data-k="info"></div>
      <div class="note">Arquetipos ilustrativos no calibrados; escala artística declarada.</div>
    `;
    document.body.appendChild(panel);
    const q = <T extends HTMLElement>(k: string): T => panel.querySelector(`[data-k="${k}"]`) as T;
    const archetype = q<HTMLSelectElement>('archetype');
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('archetype');
    archetype.value = listArchetypes().some((a) => a.id === requested)
      ? (requested as string)
      : 'broad-crown-broadleaf';
    const requestedSeed = Number(params.get('seed'));
    const seed = q<HTMLInputElement>('seed');
    if (Number.isInteger(requestedSeed) && requestedSeed > 0) seed.value = String(requestedSeed);
    const play = q<HTMLButtonElement>('play');
    const speed = q<HTMLInputElement>('speed');
    const speedLabel = q<HTMLElement>('speedLabel');
    this.info = q<HTMLElement>('info');

    const rate = (): number => Math.round(10 ** Number(speed.value) * 100) / 100;
    const reset = (): void => {
      handlers.onReset(archetype.value, Number(seed.value) >>> 0);
      if (this.playing) handlers.onPlay(rate());
    };
    archetype.addEventListener('change', reset);
    seed.addEventListener('change', reset);
    q<HTMLButtonElement>('reset').addEventListener('click', reset);
    play.addEventListener('click', () => {
      this.playing = !this.playing;
      play.textContent = this.playing ? 'Pausa' : 'Reproducir';
      if (this.playing) handlers.onPlay(rate());
      else handlers.onPause();
    });
    speed.addEventListener('input', () => {
      speedLabel.textContent = `${rate()} años/s`;
      if (this.playing) handlers.onPlay(rate());
    });
    speedLabel.textContent = `${rate()} años/s`;
    reset();
  }

  update(s: RenderSnapshot): void {
    const year = Math.floor(s.timeYears);
    this.info.textContent =
      `Año ${year} · ${s.season} · etapa ${(s.developmentalStage01 * 100).toFixed(0)} %\n` +
      `${s.segmentCount} entrenudos · ${s.livingAxes} ejes vivos · ${s.deadAxes} muertos` +
      (s.capacityReached ? '\nCapacidad alcanzada: crecimiento pausado' : '');
  }
}
