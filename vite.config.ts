import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2022',
    // three.js ocupa ~800 kB minificado; el aviso por defecto (500 kB) no aporta.
    chunkSizeWarningLimit: 1200,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
