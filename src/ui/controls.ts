import { listArchetypes } from '../sim/morphotype.ts';
import type { RenderSnapshot } from '../sim/snapshot.ts';
import { genericSpeciesId, isSpeciesId, listSpecies } from '../sim/species.ts';
import type { WindSettings } from '../sim/wind.ts';
import { seasonName } from '../sim/clock.ts';
import type { LeafCycleMode } from '../sim/leaf-cycle.ts';

export interface ControlHandlers {
  onReset(speciesId: string, seed: number): void;
  onPlay(yearsPerSecond: number): void;
  onPause(): void;
  onWind(wind: WindSettings): void;
  /** Ciclo de hojas: independiente con su velocidad (años visuales/s) o ligado al crecimiento. */
  onLeafCycle(mode: LeafCycleMode, yearsPerSecond: number): void;
  /** Bruma de la atmósfera [0, 1]. */
  onHaze(haze01: number): void;
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
      <label>Atmósfera <span data-k="hazeLabel">limpia</span>
        <input data-k="haze" type="range" min="0" max="1" step="0.05" value="0" />
      </label>
      <label>Ciclo de hojas
        <select data-k="leafMode">
          <option value="free">Independiente del crecimiento</option>
          <option value="coupled">Ligado al crecimiento</option>
        </select>
      </label>
      <label data-k="leafSpeedRow">Duración de un año de hojas <span data-k="leafSpeedLabel"></span>
        <input data-k="leafSpeed" type="range" min="5" max="180" step="5" value="40" />
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
    const leafMode = q<HTMLSelectElement>('leafMode');
    const leafSpeed = q<HTMLInputElement>('leafSpeed');
    const leafSpeedLabel = q<HTMLElement>('leafSpeedLabel');
    const leafSpeedRow = q<HTMLElement>('leafSpeedRow');
    const sendLeafCycle = (): void => {
      const seconds = Number(leafSpeed.value);
      leafSpeedLabel.textContent = `${seconds} s`;
      leafSpeedRow.style.display = leafMode.value === 'free' ? '' : 'none';
      handlers.onLeafCycle(leafMode.value as LeafCycleMode, 1 / seconds);
    };
    const requestedLeafSeconds = Number(params.get('leafSeconds'));
    if (requestedLeafSeconds > 0) leafSpeed.value = String(requestedLeafSeconds);
    if (params.get('leafCycle') === 'coupled') leafMode.value = 'coupled';
    leafMode.addEventListener('change', sendLeafCycle);
    leafSpeed.addEventListener('input', sendLeafCycle);
    this.coupled = (): boolean => leafMode.value === 'coupled';
    const haze = q<HTMLInputElement>('haze');
    const hazeLabel = q<HTMLElement>('hazeLabel');
    const sendHaze = (): void => {
      const h = Number(haze.value);
      hazeLabel.textContent = h === 0 ? 'limpia' : `bruma ${Math.round(h * 100)} %`;
      handlers.onHaze(h);
    };
    const requestedHaze = Number(params.get('haze'));
    if (requestedHaze > 0) haze.value = String(Math.min(1, requestedHaze));
    haze.addEventListener('input', sendHaze);
    sendHaze();

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
    sendLeafCycle();
  }

  private readonly coupled: () => boolean;
  private foliageLine = '';
  private lastSnapshot: RenderSnapshot | null = null;

  /** Estado del ciclo de hojas independiente (estación que muestra el follaje). */
  updateFoliage(phase: number, leaves: number): void {
    this.foliageLine = `Hojas: ${seasonName(phase)} · ${leaves} visibles`;
    if (this.lastSnapshot) this.update(this.lastSnapshot);
  }

  update(s: RenderSnapshot): void {
    this.lastSnapshot = s;
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
      (s.capacityReached ? '\nCapacidad alcanzada: crecimiento pausado' : '') +
      (this.coupled() || !this.foliageLine ? '' : `\n${this.foliageLine}`);
  }
}
