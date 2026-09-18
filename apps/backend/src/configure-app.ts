import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.getOrThrow<string[]>('CORS_ORIGINS') });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  if (config.getOrThrow<string>('NODE_ENV') === 'development') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('SmartSite API')
        .setDescription(
          'Foundation health endpoints. Business APIs and authentication are not implemented yet.',
        )
        .setVersion('0.1.0')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }
}
