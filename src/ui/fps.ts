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
