import { defineConfig } from 'vitest/config';

// Rutas relativas (base './') para poder alojar el build en cualquier hosting o iframe.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
