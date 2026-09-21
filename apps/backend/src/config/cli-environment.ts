import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { validateEnvironment } from './environment.js';
import type { BackendEnvironment } from './environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type DatabaseUrlCandidate = {
  source: 'DIRECT_URL' | 'DATABASE_URL_UNPOOLED' | 'DATABASE_URL';
  value: string;
};

function selectDatabaseUrl(
  environment: Record<string, string | undefined>,
): DatabaseUrlCandidate | undefined {
  for (const source of ['DIRECT_URL', 'DATABASE_URL_UNPOOLED', 'DATABASE_URL'] as const) {
    const value = environment[source];
    if (value !== undefined && value.length > 0) {
      return { source, value };
    }
  }

  return undefined;
}

function isNeonPooledUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname.includes('-pooler.') && hostname.endsWith('.neon.tech');
}

export function resolveCliEnvironment(
  customEnvPath?: string,
  baseEnv: Record<string, string | undefined> = process.env,
): BackendEnvironment {
  const envFilePath = customEnvPath ?? path.resolve(__dirname, '../../.env');
  const mergedEnv: Record<string, string | undefined> = { ...baseEnv };
  let fileEnv: Record<string, string | undefined> = {};

  if (fs.existsSync(envFilePath)) {
    const fileContent = fs.readFileSync(envFilePath, 'utf8');
    fileEnv = dotenv.parse(fileContent);
    for (const [key, value] of Object.entries(fileEnv)) {
      // Real environment variables take precedence over .env file values
      if (baseEnv[key] === undefined) {
        mergedEnv[key] = value;
      }
    }
  }

  const runtimeConfig = validateEnvironment(mergedEnv);
  const candidateUrl = selectDatabaseUrl(baseEnv) ?? selectDatabaseUrl(fileEnv);

  // validateEnvironment guarantees a DATABASE_URL candidate even when neither
  // the process nor the file explicitly supplies one.
  const migrationUrl = candidateUrl ?? {
    source: 'DATABASE_URL' as const,
    value: runtimeConfig.DATABASE_URL,
  };

  try {
    const parsed = new URL(migrationUrl.value);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.pathname.length <= 1
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      `${migrationUrl.source} must be a PostgreSQL URL with a host and database name`,
    );
  }

  if (migrationUrl.source === 'DATABASE_URL' && isNeonPooledUrl(migrationUrl.value)) {
    throw new Error(
      'DIRECT_URL or DATABASE_URL_UNPOOLED is required for migrations when DATABASE_URL uses a Neon pooled endpoint',
    );
  }

  return {
    ...runtimeConfig,
    DATABASE_URL: migrationUrl.value,
  };
}
