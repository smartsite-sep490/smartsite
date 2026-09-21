import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Set before any application ESM imports, including ConfigModule.forRoot().
process.env.NODE_ENV = 'test';
const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
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
  const files = readdirSync(new URL(`../${directory}/`, import.meta.url))
    .filter((file) => file.endsWith('.test.js'))
    .sort()
    .map((file) => `${directory}/${file}`);
  const result = spawnSync(
    process.execPath,
    ['--test', ...(integration ? ['--test-concurrency=1'] : []), ...files],
    {
      cwd: backendDirectory,
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error) console.error('Unable to start the backend test process.');
  process.exitCode = result.status ?? 1;
}
