import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApplication } from './configure-app.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
  Logger.log(`SmartSite API listening on port ${port}`, 'Bootstrap');
}

void bootstrap().catch(() => {
  Logger.error(
    'Backend failed to start. Check environment configuration and port availability.',
    'Bootstrap',
  );
  process.exitCode = 1;
});
