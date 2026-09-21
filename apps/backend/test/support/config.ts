import { ConfigService } from '@nestjs/config';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';

export function createTestConfig(overrides: Record<string, unknown> = {}) {
  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      ...overrides,
      NODE_ENV: 'test',
    }),
  );
  return config;
}
