import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Config de Vitest para digital-planner. Cubre las pruebas unitarias (jsdom) de
// tests/unit/**. Las pruebas de integración (tests/integration/**) se ejecutan por
// separado con `npm run test:integration`, que pasa `--environment node` en la línea
// de comandos — no necesitan jsdom y sí necesitan las APIs de servidor de Node tal cual.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Espejo del alias "@/*" -> "./*" de tsconfig.json. Debe mantenerse en sync
      // manualmente: Vitest no lee los "paths" de tsconfig.json por sí solo.
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/blueprints/**', // el bundle de blueprint vive dentro del repo (blueprints/digital-planner/) — nunca escanearlo
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'blueprints/**',
        'tests/**',
        '.next/**',
        'vitest.config.ts',
        'vitest.setup.ts',
        'scripts/**',
      ],
    },
  },
});
