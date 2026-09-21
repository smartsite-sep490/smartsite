import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from the module, never the caller's current working directory.
export const backendDirectory = fileURLToPath(
  new URL(import.meta.url.includes('/.test-build/') ? '../../../' : '../../', import.meta.url),
);

export function runtimeEnvironmentOptions(environment: Record<string, unknown> = process.env) {
  return {
    envFilePath: path.join(backendDirectory, '.env'),
    ignoreEnvFile: environment.NODE_ENV !== undefined && environment.NODE_ENV !== 'development',
  };
}
