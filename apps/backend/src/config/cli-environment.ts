import fs from 'node:fs';
import dotenv from 'dotenv';
import { databaseEnvironmentSchema, parseEnvironment, postgresUrlSchema } from './environment.js';
import type { DatabaseEnvironment } from './environment.js';
import { runtimeEnvironmentOptions } from './runtime-environment.js';

function selectDatabaseUrl(environment: Record<string, string | undefined>) {
  for (const source of ['DIRECT_URL', 'DATABASE_URL_UNPOOLED', 'DATABASE_URL'] as const) {
    const value = environment[source];
    if (value !== undefined && value.length > 0) return { source, value };
  }
  return undefined;
}

export function resolveCliEnvironment(
  customEnvPath?: string,
  baseEnv: Record<string, string | undefined> = process.env,
): DatabaseEnvironment {
  const options = runtimeEnvironmentOptions(baseEnv);
  const envFilePath = customEnvPath ?? options.envFilePath;
  const fileEnv =
    !options.ignoreEnvFile && fs.existsSync(envFilePath)
      ? dotenv.parse(fs.readFileSync(envFilePath, 'utf8'))
      : {};
  const mergedEnv = {
    ...fileEnv,
    ...Object.fromEntries(Object.entries(baseEnv).filter(([, value]) => value !== undefined)),
  };
  const candidate = selectDatabaseUrl(baseEnv) ?? selectDatabaseUrl(fileEnv);
  if (candidate && !postgresUrlSchema.safeParse(candidate.value).success) {
    throw new Error(`${candidate.source} must be a PostgreSQL URL with a host and database name`);
  }
  const config = parseEnvironment(databaseEnvironmentSchema, {
    ...mergedEnv,
    DATABASE_URL: candidate?.value ?? mergedEnv.DATABASE_URL,
  });
  const hostname = new URL(config.DATABASE_URL).hostname.toLowerCase();
  if (
    (!candidate || candidate.source === 'DATABASE_URL') &&
    hostname.includes('-pooler.') &&
    hostname.endsWith('.neon.tech')
  ) {
    throw new Error(
      'DIRECT_URL or DATABASE_URL_UNPOOLED is required for migrations when DATABASE_URL uses a Neon pooled endpoint',
    );
  }
  return config;
}
