import { listArchetypes } from '../sim/morphotype.ts';
import type { RenderSnapshot } from '../sim/snapshot.ts';
import { genericSpeciesId, isSpeciesId, listSpecies } from '../sim/species.ts';
import type { WindSettings } from '../sim/wind.ts';

export interface ControlHandlers {
  onReset(speciesId: string, seed: number): void;
  onPlay(yearsPerSecond: number): void;
  onPause(): void;
  onWind(wind: WindSettings): void;
}

/**
 * Panel provisional (fases 2 y 4): especie, semilla, reproducir, velocidad, viento y estado.
 * Los arquetipos sin especie siguen disponibles para depurar (`?archetype=`).
 */
export class ControlPanel {
  private readonly info: HTMLElement;
  private playing = false;

  constructor(private readonly handlers: ControlHandlers) {
    const panel = document.createElement('div');
    panel.className = 'panel';
    const species = listSpecies()
      .map((s) => `<option value="${s.id}">${s.name} (${s.taxon})</option>`)
      .join('');
    const archetypes = listArchetypes()
      .map((a) => `<option value="${genericSpeciesId(a.id)}">${a.name}</option>`)
      .join('');
    panel.innerHTML = `
      <label>Especie <select data-k="species">${species}
        <optgroup label="Arquetipos sin especie">${archetypes}</optgroup></select></label>
      <label>Semilla <input data-k="seed" type="number" min="0" max="4294967295" value="7" /></label>
      <div class="row">
        <button data-k="play" type="button">Reproducir</button>
        <button data-k="reset" type="button">Reiniciar</button>
      </div>
      <label>Velocidad <span data-k="speedLabel">1 año/s</span>
        <input data-k="speed" type="range" min="-2" max="2.3" step="0.1" value="0" />
      </label>
      <label>Viento <span data-k="windLabel">calma</span>
        <input data-k="wind" type="range" min="0" max="1" step="0.05" value="0" />
      </label>
      <label>Dirección del viento
        <input data-k="windDir" type="range" min="0" max="360" step="5" value="30" />
      </label>
      <div class="info" data-k="info"></div>
      <div class="note">Especies ilustrativas no calibradas; escala artística declarada.</div>
    `;
    document.body.appendChild(panel);
    const q = <T extends HTMLElement>(k: string): T => panel.querySelector(`[data-k="${k}"]`) as T;
    const select = q<HTMLSelectElement>('species');
    const params = new URLSearchParams(window.location.search);
    const requestedSpecies = params.get('species');
    const requestedArchetype = params.get('archetype');
    if (requestedSpecies && isSpeciesId(requestedSpecies)) select.value = requestedSpecies;
    else if (requestedArchetype && listArchetypes().some((a) => a.id === requestedArchetype)) {
      select.value = genericSpeciesId(requestedArchetype);
    } else select.value = 'quercus-robur';
    const requestedSeed = Number(params.get('seed'));
    const seed = q<HTMLInputElement>('seed');
    if (Number.isInteger(requestedSeed) && requestedSeed > 0) seed.value = String(requestedSeed);
    const play = q<HTMLButtonElement>('play');
    const speed = q<HTMLInputElement>('speed');
    const speedLabel = q<HTMLElement>('speedLabel');
    const wind = q<HTMLInputElement>('wind');
    const windDir = q<HTMLInputElement>('windDir');
    const windLabel = q<HTMLElement>('windLabel');
    this.info = q<HTMLElement>('info');

    const rate = (): number => Math.round(10 ** Number(speed.value) * 100) / 100;
    const reset = (): void => {
      handlers.onReset(select.value, Number(seed.value) >>> 0);
      if (this.playing) handlers.onPlay(rate());
    };
    const sendWind = (): void => {
      const intensity01 = Number(wind.value);
      windLabel.textContent = intensity01 === 0 ? 'calma' : `${Math.round(intensity01 * 100)} %`;
      handlers.onWind({ intensity01, directionRad: (Number(windDir.value) * Math.PI) / 180 });
    };
    const requestedWind = Number(params.get('wind'));
    if (requestedWind > 0) wind.value = String(Math.min(1, requestedWind));
    select.addEventListener('change', reset);
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
    wind.addEventListener('change', sendWind);
    windDir.addEventListener('change', sendWind);
    speedLabel.textContent = `${rate()} años/s`;
    sendWind();
    reset();
  }

  update(s: RenderSnapshot): void {
    const year = Math.floor(s.timeYears);
    const reproduction =
      s.flowers.count + s.fruits.count > 0
        ? `\n${s.flowers.count} flores · ${s.fruits.count} frutos (${(s.fruitMassKg * 1000).toFixed(0)} g)`
        : '';
    this.info.textContent =
      `${s.speciesName} · año ${year} · ${s.season} · ${s.phenophase}\n` +
      `etapa ${(s.developmentalStage01 * 100).toFixed(0)} % · ${s.leaves.count} hojas\n` +
      `${s.segmentCount} entrenudos · ${s.livingAxes} ejes vivos · ${s.deadAxes} muertos` +
      reproduction +
      (s.capacityReached ? '\nCapacidad alcanzada: crecimiento pausado' : '');
  }
}
