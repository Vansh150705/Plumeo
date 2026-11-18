import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror the `@/*` path alias from tsconfig.json so server modules can be imported in tests.
    alias: { '@': resolve(__dirname) },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
