import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { validateEnvironment } from './environment.js';
import type { BackendEnvironment } from './environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveCliEnvironment(
  customEnvPath?: string,
  baseEnv: Record<string, string | undefined> = process.env,
): BackendEnvironment {
  const envFilePath = customEnvPath ?? path.resolve(__dirname, '../../.env');
  const mergedEnv: Record<string, string | undefined> = { ...baseEnv };

  if (fs.existsSync(envFilePath)) {
    const fileContent = fs.readFileSync(envFilePath, 'utf8');
    const parsed = dotenv.parse(fileContent);
    for (const [key, value] of Object.entries(parsed)) {
      // Real environment variables take precedence over .env file values
      if (baseEnv[key] === undefined) {
        mergedEnv[key] = value;
      }
    }
  }

  const runtimeConfig = validateEnvironment(mergedEnv);
  const candidateDirectUrl =
    mergedEnv.DIRECT_URL !== undefined && mergedEnv.DIRECT_URL.length > 0
      ? { value: mergedEnv.DIRECT_URL, source: 'DIRECT_URL' }
      : mergedEnv.DATABASE_URL_UNPOOLED !== undefined && mergedEnv.DATABASE_URL_UNPOOLED.length > 0
        ? { value: mergedEnv.DATABASE_URL_UNPOOLED, source: 'DATABASE_URL_UNPOOLED' }
        : undefined;

  if (candidateDirectUrl === undefined) {
    return runtimeConfig;
  }

  try {
    const parsed = new URL(candidateDirectUrl.value);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.pathname.length <= 1
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      `${candidateDirectUrl.source} must be a PostgreSQL URL with a host and database name`,
    );
  }

  return {
    ...runtimeConfig,
    DATABASE_URL: candidateDirectUrl.value,
  };
}

