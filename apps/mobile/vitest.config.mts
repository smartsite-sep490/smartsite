import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    alias: {
      'react-native': fileURLToPath(new URL('./src/test/react-native.tsx', import.meta.url)),
      '@react-native-community/datetimepicker': fileURLToPath(
        new URL('./src/test/date-picker.tsx', import.meta.url),
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
});
