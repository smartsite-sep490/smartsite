import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, PARAMS_PROVIDER_TOKEN, type Params } from 'nestjs-pino';
import { pino, type DestinationStream } from 'pino';
import { pinoHttp, type Options } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BackendEnvironment } from '../config/environment.js';
import { requestPath } from '../common/http/request-id.js';
import { sanitizeError } from './sanitize-error.js';

export function createHttpLoggerOptions(config: ConfigService<BackendEnvironment, true>): Options {
  const secrets = [
    config.get('DATABASE_URL', { infer: true }),
    config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true }),
  ];
  const redactText = (text: string): string =>
    secrets
      .reduce((safe, secret) => (secret ? safe.replaceAll(secret, '[Redacted]') : safe), text)
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[Redacted]');
  return {
    level: config.get('LOG_LEVEL', { infer: true }),
    ...(config.get('LOG_FORMAT', { infer: true }) === 'pretty'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
      : {}),
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'headers.authorization',
        'headers.cookie',
        'headers["set-cookie"]',
        'body',
        'query',
        'rawPayload',
        'rawEvent',
        'evidence',
        'DATABASE_URL',
        'req.body',
        'req.query',
        'req.raw',
      ],
      remove: true,
    },
    wrapSerializers: false,
    serializers: {
      req: (req: IncomingMessage) => ({
        id: req.id,
        method: req.method,
        path: requestPath(req.url),
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      err: sanitizeError,
    },
    hooks: {
      logMethod(args, method) {
        // Pino derives msg from err.message before serialization if no message is supplied.
        if (args[0] instanceof Error) args[0] = { err: args[0] };
        if (typeof args[0] === 'object' && args[0] !== null && 'err' in args[0]) {
          args[1] = 'Operation failed';
          args.length = 2;
        }
        for (let index = 0; index < args.length; index += 1) {
          const argument = args[index];
          if (typeof argument === 'string') args[index] = redactText(argument);
        }
        method.apply(this, args);
      },
    },
    genReqId: (req) => req.id,
    customProps: (req) => ({ requestId: req.id }),
    customLogLevel: (_req, res) =>
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    customSuccessMessage: () => 'HTTP request completed',
    customErrorMessage: () => 'HTTP request failed',
  };
}

export function createLoggerParams(
  config: ConfigService<BackendEnvironment, true>,
  stream?: DestinationStream,
): Params {
  const options = createHttpLoggerOptions(config);
  const logger = stream ? pino(options, stream) : pino(options);
  // The early middleware owns access logging; nestjs-pino only binds its existing req.log.
  return { useExisting: true, pinoHttp: { ...options, transport: undefined, logger } };
}

export function installRequestLogging(app: NestExpressApplication): void {
  const params = app.get<Params>(PARAMS_PROVIDER_TOKEN);
  app.use(pinoHttp(params.pinoHttp as Options));
  app.useLogger(app.get(Logger));
}
