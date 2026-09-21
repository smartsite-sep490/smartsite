import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, PARAMS_PROVIDER_TOKEN, type Params } from 'nestjs-pino';
import { pino, type DestinationStream } from 'pino';
import { pinoHttp, type Options } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BackendEnvironment } from '../config/environment.js';
import { requestPath } from '../common/http/request-id.js';
import { sanitizeError } from './sanitize-error.js';

const REDACTED = '[Redacted]';
const OMITTED = '[Omitted]';
const MAX_LOG_DEPTH = 8;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSecretKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    /token|password|authorization|cookie|secret/.test(normalized) ||
    (normalized.includes('database') && normalized.includes('url')) ||
    normalized === 'directurl'
  );
}

function isRemovedKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return (
    ['body', 'query', 'rawbody', 'rawpayload', 'rawevent'].includes(normalized) ||
    normalized.startsWith('evidence')
  );
}

function sanitizeLogValue(
  value: unknown,
  redactText: (value: string) => string,
  depth = 0,
  seen = new WeakSet<object>(),
  preservePinoSerializers = false,
): unknown {
  if (typeof value === 'string') return redactText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_LOG_DEPTH) return OMITTED;
  if (value instanceof Error)
    return sanitizeLogValue(sanitizeError(value), redactText, depth + 1, seen);
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return OMITTED;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => sanitizeLogValue(item, redactText, depth + 1, seen));
  } else {
    const safe: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isRemovedKey(key)) continue;
      if (isSecretKey(key)) {
        safe[key] = REDACTED;
      } else if (preservePinoSerializers && ['req', 'res', 'err'].includes(key)) {
        safe[key] = item;
      } else {
        safe[key] = sanitizeLogValue(item, redactText, depth + 1, seen);
      }
    }
    result = safe;
  }
  seen.delete(value);
  return result;
}

export function createHttpLoggerOptions(config: ConfigService<BackendEnvironment, true>): Options {
  const secrets = [
    config.get('DATABASE_URL', { infer: true }),
    config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true }),
  ].filter(Boolean);
  const redactText = (text: string): string =>
    secrets
      .sort((left, right) => right.length - left.length)
      .reduce((safe, secret) => safe.replaceAll(secret, REDACTED), text)
      .replace(/\bBearer\s+[^\s,;"']+/gi, REDACTED)
      .replace(/postgres(?:ql)?:\/\/[^\s,;"']+/gi, REDACTED);
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
        const hasError = typeof args[0] === 'object' && args[0] !== null && 'err' in args[0];
        for (let index = 0; index < args.length; index += 1) {
          args[index] = sanitizeLogValue(
            args[index],
            redactText,
            0,
            new WeakSet<object>(),
            index === 0,
          );
        }
        if (hasError) {
          args[1] = 'Operation failed';
          args.length = 2;
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
