/**
 * Contador de fotogramas por segundo: media de cada medio segundo y peor fotograma
 * (ms) del intervalo, en una esquina de la vista.
 */
export class FpsCounter {
  private readonly el: HTMLElement;
  private frames = 0;
  private windowStart = performance.now();
  private last = performance.now();
  private worstMs = 0;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'fps';
    this.el.textContent = '— fps';
    document.body.appendChild(this.el);
  }

  /** Última medida del hilo principal por fotograma (ms) y triángulos dibujados. */
  last_profile: { rig: number; particles: number; submit: number; triangles: number } = {
    rig: 0,
    particles: 0,
    submit: 0,
    triangles: 0,
  };

  profile(ms: { rig: number; particles: number; submit: number }, triangles: number): void {
    const k = 0.1;
    const l = this.last_profile;
    l.rig += (ms.rig - l.rig) * k;
    l.particles += (ms.particles - l.particles) * k;
    l.submit += (ms.submit - l.submit) * k;
    l.triangles = triangles;
  }

  /** Llamar una vez por fotograma. */
  tick(now = performance.now()): void {
    this.frames++;
    this.worstMs = Math.max(this.worstMs, now - this.last);
    this.last = now;
    const elapsed = now - this.windowStart;
    if (elapsed >= 500) {
      const fps = (this.frames * 1000) / elapsed;
      this.el.textContent = `${fps.toFixed(0)} fps · máx ${this.worstMs.toFixed(0)} ms`;
      this.frames = 0;
      this.worstMs = 0;
      this.windowStart = now;
    }
  }
}
