import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/web/src/**/*.ui.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});
