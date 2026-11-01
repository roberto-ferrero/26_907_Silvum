import { seasonName } from '../sim/clock.ts';
import type { LeafCycleMode } from '../sim/leaf-cycle.ts';
import { listArchetypes } from '../sim/morphotype.ts';
import type { RenderSnapshot } from '../sim/snapshot.ts';
import { genericSpeciesId, isSpeciesId, listSpecies } from '../sim/species.ts';
import type { WindSettings } from '../sim/wind.ts';

/** Año en que arranca el árbol si la URL no dice otra cosa. */
export const DEFAULT_START_YEARS = 25;
/** Fase del año con la que arranca el ciclo de hojas (primavera avanzada). */
export const DEFAULT_LEAF_PHASE = 0.4;
/** Extremo de la línea de tiempo (años). */
export const TIMELINE_MAX_YEARS = 80;

export interface ControlHandlers {
  onReset(speciesId: string, seed: number): void;
  onPlay(yearsPerSecond: number): void;
  onPause(): void;
  /** Salto a un año de la línea de tiempo (hacia delante o atrás). */
  onSeek(years: number): void;
  onWind(wind: WindSettings): void;
  onHaze(haze01: number): void;
  /** Ciclo de hojas: independiente o ligado, velocidad (años visuales/s) y reproducción. */
  onLeafCycle(mode: LeafCycleMode, yearsPerSecond: number, playing: boolean): void;
  /** Fija la estación que muestra el ciclo de hojas. */
  onLeafPhase(phase: number): void;
  /** Aspecto de las hojas: multiplicadores de número y de tamaño (solo dibujo). */
  onLeafLook(count: number, size: number): void;
  /** Panel de diagnóstico (fase 7.6). */
  onDiagnostics(options: DiagnosticsOptions): void;
}

export interface DiagnosticsOptions {
  skeleton: boolean;
  lightMap: boolean;
}

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const monthOf = (phase: number): string => MONTHS[Math.floor((phase % 1) * 12)] ?? 'enero';

/**
 * Panel de control (fase 7): árbol, línea de tiempo, hojas, entorno, estado y
 * diagnóstico, en secciones plegables.
 */
export class ControlPanel {
  private readonly info: HTMLElement;
  private readonly timeline: HTMLInputElement;
  private readonly yearLabel: HTMLElement;
  private readonly cacheLabel: HTMLElement;
  private readonly leafPhaseInput: HTMLInputElement;
  private readonly leafPhaseLabel: HTMLElement;
  private readonly events: HTMLElement;
  private playing = false;
  private seeking = false;
  private foliageLine = '';
  private lastSnapshot: RenderSnapshot | null = null;
  private readonly coupled: () => boolean;

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
      <details open><summary>Árbol</summary>
        <label>Especie <select data-k="species">${species}
          <optgroup label="Arquetipos sin especie">${archetypes}</optgroup></select></label>
        <div class="row">
          <label class="grow">Semilla <input data-k="seed" type="number" min="0" max="4294967295" value="7" /></label>
          <button data-k="reset" type="button" class="align-end">Reiniciar</button>
        </div>
      </details>
      <details open><summary>Tiempo</summary>
        <label>Año <span data-k="yearLabel">0</span> <span class="muted" data-k="cacheLabel"></span>
          <input data-k="timeline" type="range" min="0" max="${TIMELINE_MAX_YEARS}" step="0.25" value="0" />
        </label>
        <div class="row">
          <button data-k="play" type="button">▶ Crecer</button>
        </div>
        <label>Velocidad <span data-k="speedLabel">1 año/s</span>
          <input data-k="speed" type="range" min="-2" max="2.3" step="0.1" value="0" />
        </label>
      </details>
      <details open><summary>Hojas</summary>
        <label>Ciclo
          <select data-k="leafMode">
            <option value="free">Independiente del crecimiento</option>
            <option value="coupled">Ligado al crecimiento</option>
          </select>
        </label>
        <div data-k="leafFree" class="group">
          <div class="row">
            <button data-k="leafPlay" type="button">▶ Estaciones</button>
          </div>
          <label>Estación <span data-k="leafPhaseLabel"></span>
            <input data-k="leafPhase" type="range" min="0" max="0.995" step="0.005" value="${DEFAULT_LEAF_PHASE}" />
          </label>
          <label>Duración de un año de hojas <span data-k="leafSpeedLabel"></span>
            <input data-k="leafSpeed" type="range" min="5" max="180" step="5" value="40" />
          </label>
        </div>
        <label>Número de hojas <span data-k="leafCountLabel"></span>
          <input data-k="leafCount" type="range" min="0.25" max="3" step="0.05" value="1" />
        </label>
        <label>Tamaño de hojas <span data-k="leafSizeLabel"></span>
          <input data-k="leafSize" type="range" min="0.5" max="2" step="0.05" value="1" />
        </label>
      </details>
      <details><summary>Entorno</summary>
        <label>Viento <span data-k="windLabel">calma</span>
          <input data-k="wind" type="range" min="0" max="1" step="0.05" value="0" />
        </label>
        <label>Dirección del viento
          <input data-k="windDir" type="range" min="0" max="360" step="5" value="30" />
        </label>
        <label>Atmósfera <span data-k="hazeLabel">limpia</span>
          <input data-k="haze" type="range" min="0" max="1" step="0.05" value="0" />
        </label>
      </details>
      <details open><summary>Estado</summary>
        <div class="info" data-k="info"></div>
      </details>
      <details><summary>Diagnóstico</summary>
        <label class="check"><input data-k="diagSkeleton" type="checkbox" /> Esqueleto (cilindros por papel)</label>
        <label class="check"><input data-k="diagLight" type="checkbox" /> Mapa de luz de las yemas</label>
        <div class="events" data-k="events"></div>
      </details>
      <div class="note">Especies ilustrativas no calibradas; escala artística declarada.</div>
    `;
    document.body.appendChild(panel);
    const q = <T extends HTMLElement>(k: string): T => panel.querySelector(`[data-k="${k}"]`) as T;
    const params = new URLSearchParams(window.location.search);

    // ── Árbol ──
    const select = q<HTMLSelectElement>('species');
    const requestedSpecies = params.get('species');
    const requestedArchetype = params.get('archetype');
    if (requestedSpecies && isSpeciesId(requestedSpecies)) select.value = requestedSpecies;
    else if (requestedArchetype && listArchetypes().some((a) => a.id === requestedArchetype)) {
      select.value = genericSpeciesId(requestedArchetype);
    } else select.value = 'quercus-robur';
    const seed = q<HTMLInputElement>('seed');
    const requestedSeed = Number(params.get('seed'));
    if (Number.isInteger(requestedSeed) && requestedSeed > 0) seed.value = String(requestedSeed);

    // ── Tiempo ──
    const play = q<HTMLButtonElement>('play');
    const speed = q<HTMLInputElement>('speed');
    const speedLabel = q<HTMLElement>('speedLabel');
    this.timeline = q<HTMLInputElement>('timeline');
    this.yearLabel = q<HTMLElement>('yearLabel');
    this.cacheLabel = q<HTMLElement>('cacheLabel');
    const rate = (): number => Math.round(10 ** Number(speed.value) * 100) / 100;
    const startYears = Number(params.get('years'));
    const start = startYears > 0 ? startYears : DEFAULT_START_YEARS;
    const reset = (): void => {
      handlers.onReset(select.value, Number(seed.value) >>> 0);
      handlers.onSeek(start);
      if (this.playing) handlers.onPlay(rate());
    };
    select.addEventListener('change', reset);
    seed.addEventListener('change', reset);
    q<HTMLButtonElement>('reset').addEventListener('click', reset);
    play.addEventListener('click', () => {
      this.playing = !this.playing;
      play.textContent = this.playing ? '⏸ Pausa' : '▶ Crecer';
      if (this.playing) handlers.onPlay(rate());
      else handlers.onPause();
    });
    speed.addEventListener('input', () => {
      speedLabel.textContent = `${rate()} años/s`;
      if (this.playing) handlers.onPlay(rate());
    });
    speedLabel.textContent = `${rate()} años/s`;
    this.timeline.addEventListener('input', () => {
      this.seeking = true;
      this.yearLabel.textContent = Number(this.timeline.value).toFixed(1);
    });
    this.timeline.addEventListener('change', () => {
      this.seeking = false;
      handlers.onSeek(Number(this.timeline.value));
    });

    // ── Hojas ──
    const leafMode = q<HTMLSelectElement>('leafMode');
    const leafFree = q<HTMLElement>('leafFree');
    const leafPlay = q<HTMLButtonElement>('leafPlay');
    const leafSpeed = q<HTMLInputElement>('leafSpeed');
    const leafSpeedLabel = q<HTMLElement>('leafSpeedLabel');
    this.leafPhaseInput = q<HTMLInputElement>('leafPhase');
    this.leafPhaseLabel = q<HTMLElement>('leafPhaseLabel');
    let leafPlaying = params.get('leafPlay') === '1';
    const requestedLeafSeconds = Number(params.get('leafSeconds'));
    if (requestedLeafSeconds > 0) leafSpeed.value = String(requestedLeafSeconds);
    if (params.get('leafCycle') === 'coupled') leafMode.value = 'coupled';
    const sendLeafCycle = (): void => {
      const seconds = Number(leafSpeed.value);
      leafSpeedLabel.textContent = `${seconds} s`;
      leafFree.style.display = leafMode.value === 'free' ? '' : 'none';
      leafPlay.textContent = leafPlaying ? '⏸ Estaciones' : '▶ Estaciones';
      handlers.onLeafCycle(leafMode.value as LeafCycleMode, 1 / seconds, leafPlaying);
    };
    leafMode.addEventListener('change', sendLeafCycle);
    leafSpeed.addEventListener('input', sendLeafCycle);
    leafPlay.addEventListener('click', () => {
      leafPlaying = !leafPlaying;
      sendLeafCycle();
    });
    this.leafPhaseInput.addEventListener('input', () => {
      const phase = Number(this.leafPhaseInput.value);
      this.showLeafPhase(phase);
      handlers.onLeafPhase(phase);
    });
    this.coupled = (): boolean => leafMode.value === 'coupled';
    const leafCount = q<HTMLInputElement>('leafCount');
    const leafSize = q<HTMLInputElement>('leafSize');
    const sendLeafLook = (): void => {
      q<HTMLElement>('leafCountLabel').textContent = `× ${Number(leafCount.value).toFixed(2)}`;
      q<HTMLElement>('leafSizeLabel').textContent = `× ${Number(leafSize.value).toFixed(2)}`;
      handlers.onLeafLook(Number(leafCount.value), Number(leafSize.value));
    };
    leafCount.addEventListener('input', sendLeafLook);
    leafSize.addEventListener('input', sendLeafLook);

    // ── Entorno ──
    const wind = q<HTMLInputElement>('wind');
    const windDir = q<HTMLInputElement>('windDir');
    const windLabel = q<HTMLElement>('windLabel');
    const sendWind = (): void => {
      const intensity01 = Number(wind.value);
      windLabel.textContent = intensity01 === 0 ? 'calma' : `${Math.round(intensity01 * 100)} %`;
      handlers.onWind({ intensity01, directionRad: (Number(windDir.value) * Math.PI) / 180 });
    };
    const requestedWind = Number(params.get('wind'));
    if (requestedWind > 0) wind.value = String(Math.min(1, requestedWind));
    wind.addEventListener('change', sendWind);
    windDir.addEventListener('change', sendWind);
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

    // ── Diagnóstico ──
    this.info = q<HTMLElement>('info');
    this.events = q<HTMLElement>('events');
    const diagSkeleton = q<HTMLInputElement>('diagSkeleton');
    const diagLight = q<HTMLInputElement>('diagLight');
    diagSkeleton.checked = params.get('skeleton') === '1';
    const sendDiagnostics = (): void =>
      handlers.onDiagnostics({ skeleton: diagSkeleton.checked, lightMap: diagLight.checked });
    diagSkeleton.addEventListener('change', sendDiagnostics);
    diagLight.addEventListener('change', sendDiagnostics);

    // Arranque: árbol, entorno y hojas.
    this.showLeafPhase(DEFAULT_LEAF_PHASE);
    sendWind();
    sendHaze();
    sendLeafCycle();
    handlers.onLeafPhase(DEFAULT_LEAF_PHASE);
    sendLeafLook();
    sendDiagnostics();
    reset();
  }

  private showLeafPhase(phase: number): void {
    this.leafPhaseLabel.textContent = `${seasonName(phase)} (${monthOf(phase)})`;
  }

  /** Estado del ciclo de hojas independiente (estación que muestra el follaje). */
  updateFoliage(phase: number, leaves: number): void {
    this.foliageLine = `Hojas: ${seasonName(phase)} · ${leaves} visibles`;
    if (document.activeElement !== this.leafPhaseInput) {
      this.leafPhaseInput.value = String(phase);
      this.showLeafPhase(phase);
    }
    if (this.lastSnapshot) this.update(this.lastSnapshot);
  }

  /** El Worker está calculando un salto. */
  setBusy(busy: boolean): void {
    this.yearLabel.classList.toggle('busy', busy);
    if (busy) this.yearLabel.textContent = `${this.timeline.value} · calculando…`;
  }

  /** Hasta qué año hay instantáneas precalculadas (saltos inmediatos). */
  updateCache(cachedYears: number): void {
    this.cacheLabel.textContent = cachedYears > 0 ? `· listo hasta ${Math.floor(cachedYears)}` : '';
  }

  update(s: RenderSnapshot): void {
    this.lastSnapshot = s;
    const year = Math.floor(s.timeYears + 1e-6);
    if (!this.seeking) {
      this.timeline.value = String(s.timeYears);
      this.yearLabel.textContent = s.timeYears.toFixed(1);
    }
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
    this.events.textContent = s.recentEvents.join('\n');
  }
}
