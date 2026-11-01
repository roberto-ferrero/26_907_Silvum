import { describe, expect, it } from 'vitest';
import { fogRange, seasonLook } from '../src/render/seasonal-light.ts';

describe('luz por estación', () => {
  it('sol alto en verano, bajo en invierno y cálido en otoño', () => {
    const summer = seasonLook(0.55);
    const winter = seasonLook(0.04);
    const autumn = seasonLook(0.8);
    expect(summer.sunElevation).toBeGreaterThan(winter.sunElevation);
    expect(summer.sunIntensity).toBeGreaterThan(winter.sunIntensity);
    // Otoño: más rojo que azul en el sol.
    expect(autumn.sunColor[0] - autumn.sunColor[2]).toBeGreaterThan(
      summer.sunColor[0] - summer.sunColor[2],
    );
  });

  it('es continua a lo largo del año (también al pasar de diciembre a enero)', () => {
    let prev = seasonLook(0);
    for (let p = 0.01; p <= 1.0001; p += 0.01) {
      const next = seasonLook(p);
      expect(Math.abs(next.sunElevation - prev.sunElevation)).toBeLessThan(0.08);
      prev = next;
    }
  });

  it('la bruma acerca la niebla', () => {
    expect(fogRange(1).far).toBeLessThan(fogRange(0).far);
    expect(fogRange(0.5).near).toBeLessThan(fogRange(0).near);
  });
});
