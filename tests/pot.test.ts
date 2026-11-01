import { describe, expect, it } from 'vitest';
import { DEFAULT_POT, soilTopY } from '../src/render/pot.ts';

describe('maceta', () => {
  it('el sustrato asoma sobre el borde menos de 1 cm', () => {
    const rim = DEFAULT_POT.footHeight + DEFAULT_POT.height;
    const y = soilTopY(DEFAULT_POT);
    expect(y).toBeGreaterThan(rim);
    expect(y - rim).toBeLessThan(0.01);
  });
});
