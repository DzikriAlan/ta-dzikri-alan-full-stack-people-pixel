import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/setup-env.ts'],

    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
