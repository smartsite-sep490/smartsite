import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireTestBuildLock } from './test-build-lock.mjs';

// Set before any application ESM imports, including ConfigModule.forRoot().
process.env.NODE_ENV = 'test';
const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
const release = acquireTestBuildLock(
  resolve(backendDirectory, 'node_modules/.smartsite-backend-test.lock'),
);
process.once('exit', release);
if (process.argv.includes('--prepare')) {
  const buildDirectory = resolve(backendDirectory, '.test-build');
  if (dirname(buildDirectory) !== resolve(backendDirectory))
    throw new Error('Invalid test build directory');
  rmSync(buildDirectory, { recursive: true, force: true });
  const require = createRequire(import.meta.url);
  const compilation = spawnSync(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.test.json'],
    { cwd: backendDirectory, env: process.env, stdio: 'inherit' },
  );
  if (compilation.error || compilation.status !== 0) process.exit(compilation.status ?? 1);
}
const { validateEnvironment } = await import('../.test-build/src/config/environment.js');
for (const key of [
  ...Object.keys(validateEnvironment({ NODE_ENV: 'test' })),
  'DIRECT_URL',
  'DATABASE_URL_UNPOOLED',
  'OPENAI_API_KEY',
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
    // Nest bootstrap fixtures spawn children; keep startup contention bounded
    // when Turbo also runs the browser suite. Assertion/time limits stay intact.
    ['--test', '--test-concurrency=1', ...files],
    {
      cwd: backendDirectory,
      env: process.env,
      stdio: 'inherit',
    },
  );
  if (result.error) console.error('Unable to start the backend test process.');
  process.exitCode = result.status ?? 1;
}
