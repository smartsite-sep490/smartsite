import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { pino } from 'pino';
import type { BackendEnvironment } from './config/environment.js';
import { sanitizeError } from './observability/sanitize-error.js';
import { configureApplication } from './configure-app.js';
import { BoundedExpressAdapter } from './common/http/bounded-express-adapter.js';

async function bootstrap(): Promise<NestExpressApplication> {
  // ConfigModule validates during module evaluation; keep it inside the startup error boundary.
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new BoundedExpressAdapter(),
    { bodyParser: false, bufferLogs: true, abortOnError: false },
  );
  try {
    await configureApplication(app);
    const port = app
      .get<ConfigService<BackendEnvironment, true>>(ConfigService)
      .get('PORT', { infer: true });
    await app.listen(port, '0.0.0.0');
    Logger.log(`SmartSite API listening on port ${port}`, 'Bootstrap');
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

// Starts on module evaluation exactly as the CLI entrypoint always did. Export
// the actual initialized application for owned native lifecycle qualification;
// no alternate bootstrap, production shutdown transport or provider override.
export const runtimeStartup = bootstrap().catch((error: unknown) => {
  pino({ serializers: { err: sanitizeError } }).error({ err: error }, 'Backend failed to start');
  process.exitCode = 1;
  return null;
});
