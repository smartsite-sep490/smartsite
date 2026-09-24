import { ConfigService } from '@nestjs/config';
import { HttpStatus, NotFoundException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { Request, Response } from 'express';
import type { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { BackendEnvironment } from './config/environment.js';
import { requestIdMiddleware } from './common/http/request-id.js';
import {
  HttpExceptionFilter,
  normalizeBodyParserError,
} from './common/http/http-exception.filter.js';
import { installRequestLogging } from './observability/logger.js';
import {
  PublicHttpException,
  type PublicValidationIssue,
} from './common/http/public-http-exception.js';

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function validationIssues(errors: ValidationError[], parent = ''): PublicValidationIssue[] {
  return errors.flatMap((error) => {
    const path = `${parent}/${pointerSegment(error.property)}`;
    const constraints = Object.keys(error.constraints ?? {});
    const unknownField = constraints.includes('whitelistValidation');
    const own = constraints.length
      ? [
          {
            code: unknownField ? 'UNKNOWN_FIELD' : 'INVALID_VALUE',
            path,
            message: unknownField ? 'Unknown field' : 'Invalid value',
          },
        ]
      : [];
    return [...own, ...validationIssues(error.children ?? [], path)];
  });
}

export async function configureApplication(app: NestExpressApplication): Promise<void> {
  const config = app.get<ConfigService<BackendEnvironment, true>>(ConfigService);
  app.use(requestIdMiddleware);
  installRequestLogging(app);
  app.use(helmet());
  // Mount CORS before parsers so preflight and parser errors have the same public headers.
  app.getHttpAdapter().enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    credentials: false,
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
  app.use(normalizeBodyParserError);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        new PublicHttpException(HttpStatus.BAD_REQUEST, {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          issues: validationIssues(errors),
        }),
    }),
  );
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  if (config.get('NODE_ENV', { infer: true }) === 'development') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('SmartSite API')
        .setDescription(
          'SmartSite foundation APIs, including authenticated AI observation ingestion for MF05/MF06.',
        )
        .setVersion('0.1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'user-token')
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'ai-service-token')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.init();
  // Nest scopes its default 404 handler to the API prefix. Cover other paths too.
  const filter = app.get(HttpExceptionFilter);
  const adapter = app.getHttpAdapter() as ExpressAdapter;
  adapter.setNotFoundHandler((req: Request, res: Response) => {
    filter.reply(new NotFoundException(), req, res);
  });
}
