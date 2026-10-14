import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { BoundedExpressAdapter } from '../../src/common/http/bounded-express-adapter.js';
import type { BackendEnvironment } from '../../src/config/environment.js';

// Native Windows qualification control around the actual compiled main entrypoint.
// IPC exists only in this test wrapper, never in production main.ts or HTTP.
async function run() {
  if (!process.send) throw new Error('Owned test IPC required');
  const database = new URL(process.env.DATABASE_URL ?? '');
  if (
    database.hostname !== '127.0.0.1' ||
    database.port !== '5433' ||
    database.pathname !== '/smartsite_test' ||
    !/^-c search_path=isolated_test_[a-f0-9]{32}$/.test(database.searchParams.get('options') ?? '')
  )
    throw new Error('Owned test database scope required');
  const entrypoint = (await import('../../src/main.js')) as unknown as {
    runtimeStartup?: Promise<NestExpressApplication | null>;
  };
  if (!entrypoint.runtimeStartup) throw new Error('Compiled main startup handle unavailable');
  const app = await entrypoint.runtimeStartup;
  if (!app) throw new Error('Compiled main failed to start');
  const adapter = app.getHttpAdapter();
  if (!(adapter instanceof BoundedExpressAdapter)) throw new Error('Main drain adapter required');
  let closing: Promise<void> | undefined;
  try {
    process.on('message', (message: unknown) => {
      if (message === 'BEGIN_DRAIN') {
        adapter.beforeClose();
        process.send?.({ type: 'DRAINING', poolInitialized: app.get(DataSource).isInitialized });
      } else if (message === 'CLOSE' && !closing) {
        closing = app.close().then(() => {
          process.send?.(
            {
              type: 'CLOSED',
              poolInitialized: app.get(DataSource).isInitialized,
              deadlineExceeded: adapter.drainDeadlineExceeded,
            },
            () => process.disconnect(),
          );
        });
        void closing.catch(() => {
          process.exitCode = 1;
          process.disconnect();
        });
      }
    });
    process.send({
      type: 'READY',
      entrypoint: 'main.ts',
      registeredMigrations: app.get(DataSource).migrations.length,
      productionConfig:
        app.get<ConfigService<BackendEnvironment, true>>(ConfigService).get('NODE_ENV', {
          infer: true,
        }) === 'production',
    });
  } catch (error) {
    await app.close();
    throw error;
  }
}
void run().catch(() => {
  // Do not serialize environment/connection errors containing private inputs.
  process.exitCode = 1;
  process.disconnect?.();
});
