import { spawnSync } from 'node:child_process';
import { cpSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Set before any application ESM imports, including ConfigModule.forRoot().
process.env.NODE_ENV = 'test';
const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
// Integrity tests read the original frozen TypeScript bytes and provenance,
// which tsc does not emit beside the compiled historical test profile.
cpSync(
  new URL('../test/support/legacy24/', import.meta.url),
  new URL('../.test-build/test/support/legacy24/', import.meta.url),
  { recursive: true },
);
const { validateEnvironment } = await import('../.test-build/src/config/environment.js');
for (const key of [
  ...Object.keys(validateEnvironment({ NODE_ENV: 'test' })),
  'DIRECT_URL',
  'DATABASE_URL_UNPOOLED',
  ...Object.keys(process.env).filter((key) => key.startsWith('PG')),
]) {
  if (key !== 'NODE_ENV') delete process.env[key];
}

const integration = process.argv.includes('--integration');
const strictWorkforce = process.argv.includes('--strict-workforce');
if (strictWorkforce && !integration) {
  throw new Error('--strict-workforce requires the isolated integration database.');
}
if (integration) {
  const { resolveTestDatabaseUrl } =
    await import('../.test-build/test/support/test-environment.js');
  process.env.TEST_DATABASE_URL = resolveTestDatabaseUrl();
  const { default: source } = await import('../.test-build/test/support/test-data-source.js');
  try {
    await source.initialize();
    await source.runMigrations();
  } catch {
    console.error(
      'Test database initialization or migration failed; verify the dedicated local TEST_DATABASE_URL and PostgreSQL service.',
    );
    process.exitCode = 1;
  } finally {
    if (source.isInitialized) await source.destroy();
  }
} else {
  delete process.env.TEST_DATABASE_URL;
}

if (!process.exitCode) {
  const directory = integration ? '.test-build/test/integration' : '.test-build/test';
  const allFiles = readdirSync(new URL(`../${directory}/`, import.meta.url))
    .filter((file) => file.endsWith('.test.js'))
    .sort();
  // Application transaction gate; the full suite still checks TypeORM schema
  // introspection separately and does not suppress its dependency warnings.
  const workforceFiles = [
    'mf07-scheduling-queries.integration.test.js',
    'mf07-shared-contractor.integration.test.js',
    'workforce-authority-writers.integration.test.js',
    'workforce-review-reader.integration.test.js',
    'workforce-zone-authority-history.integration.test.js',
    'safety-business-http.integration.test.js',
  ];
  if (strictWorkforce && workforceFiles.some((file) => !allFiles.includes(file))) {
    throw new Error(
      'Strict Workforce integration files are missing; compile the complete test suite.',
    );
  }
  const files = (strictWorkforce ? workforceFiles : allFiles).map((file) => `${directory}/${file}`);
  const result = spawnSync(
    process.execPath,
    // Keep Nest child-process fixtures bounded on a shared desktop.
    [
      ...(strictWorkforce ? ['--throw-deprecation'] : []),
      '--test',
      '--test-concurrency=1',
      ...files,
    ],
    {
      cwd: backendDirectory,
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error) console.error('Unable to start the backend test process.');
  process.exitCode = result.status ?? 1;
}
