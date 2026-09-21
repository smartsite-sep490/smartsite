import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { backendDirectory } from '../../src/config/runtime-environment.js';

export function resolveTestDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
  envFilePath = path.join(backendDirectory, '.env.test'),
): string {
  const value =
    environment.TEST_DATABASE_URL ??
    (fs.existsSync(envFilePath)
      ? dotenv.parse(fs.readFileSync(envFilePath, 'utf8')).TEST_DATABASE_URL
      : undefined);
  if (!value) throw new Error('TEST_DATABASE_URL must be explicitly set for integration tests');
  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      decodeURIComponent(url.username) !== 'smartsite_test' ||
      decodeURIComponent(url.pathname) !== '/smartsite_test' ||
      !url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new Error(
      'TEST_DATABASE_URL must target a local PostgreSQL smartsite_test database with the smartsite_test user, a password, and no query or fragment',
    );
  }
  return value;
}
