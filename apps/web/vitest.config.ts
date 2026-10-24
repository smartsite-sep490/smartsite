import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    // Never read operator dotenv values into fixture-driven tests.
    envDir: false,
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/i18n/test-setup.ts'],
      maxWorkers: 1,
      fileParallelism: false,
    },
  }),
);
