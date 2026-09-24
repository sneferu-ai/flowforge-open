import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@flowforge/shared': resolve(root, 'packages/shared/src/index.ts'),
      '@flowforge/engine': resolve(root, 'packages/engine/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    exclude: ['tests/e2e/**', 'node_modules/**', '**/dist/**'],
  },
});
