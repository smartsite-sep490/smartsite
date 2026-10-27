import type { NestExpressApplication } from '@nestjs/platform-express';

async function run() {
  if (!process.send || process.env.NODE_ENV !== 'production')
    throw new Error('Owned production-config test IPC required');
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    database.hostname !== '127.0.0.1' ||
    database.port !== '5433' ||
    database.pathname !== '/smartsite_test' ||
    !/^-c search_path=isolated_test_[a-f0-9]{32}$/.test(database.searchParams.get('options') ?? '')
  )
    throw new Error('Owned database scope required');
  const entrypoint = (await import('../../src/main.js')) as unknown as {
    runtimeStartup?: Promise<NestExpressApplication | null>;
  };
  if (!entrypoint.runtimeStartup) throw new Error('Main startup result unavailable');
  const app = await entrypoint.runtimeStartup;
  if (app !== null) {
    await app.close();
    throw new Error('Invalid production configuration unexpectedly started');
  }
  process.send({ type: 'STARTUP_FAILED', app: null, exitCode: process.exitCode }, () =>
    process.disconnect(),
  );
}

void run().catch(() => {
  process.exitCode = 1;
  process.disconnect?.();
});
