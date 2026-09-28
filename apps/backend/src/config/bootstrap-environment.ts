import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

import { validateEnvironment, type BackendEnvironment } from './environment.js';

/** Resolve one-time bootstrap settings from process env, then local .env in development. */
export function resolveBootstrapEnvironment(
  baseEnv: Record<string, string | undefined> = process.env,
): BackendEnvironment {
  const fileEnv =
    (baseEnv.NODE_ENV === undefined || baseEnv.NODE_ENV === 'development') &&
    existsSync(resolve(process.cwd(), '.env'))
      ? dotenv.parse(readFileSync(resolve(process.cwd(), '.env'), 'utf8'))
      : {};

  return validateEnvironment({
    ...fileEnv,
    ...Object.fromEntries(
      Object.entries(baseEnv).filter(([, value]) => value !== undefined),
    ),
  });
}
