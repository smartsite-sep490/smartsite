import {
  Catch,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { requestPath } from './request-id.js';
import type { ErrorResponseDto } from './error-response.dto.js';

/** Only middleware errors reach here; controller errors go directly to the Nest filter. */
export function normalizeBodyParserError(
  error: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (typeof error === 'object' && error !== null) {
    const parserError = error as { status?: unknown; statusCode?: unknown; type?: unknown };
    const status = parserError.status ?? parserError.statusCode;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500) {
      // Parser messages can embed payloads, charset names or other untrusted input.
      const message =
        parserError.type === 'entity.parse.failed'
          ? 'Invalid JSON payload'
          : (STATUS_CODES[status] ?? 'Invalid request');
      return next(new HttpException(message, status, { cause: error }));
    }
  }
  next(error);
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    this.reply(exception, http.getRequest<Request>(), http.getResponse<Response>());
  }

  reply(exception: unknown, req: Request, res: Response): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const publicResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    const details =
      typeof publicResponse === 'object' && publicResponse !== null
        ? (publicResponse as Record<string, unknown>)
        : {};
    const fallback =
      status === 500 ? 'Internal server error' : (STATUS_CODES[status] ?? 'Request failed');
    const candidate = typeof publicResponse === 'string' ? publicResponse : details.message;
    const message =
      status === 500 || status === 404
        ? fallback
        : typeof candidate === 'string'
          ? candidate
          : Array.isArray(candidate) && candidate.every((item) => typeof item === 'string')
            ? candidate
            : fallback;
    const body: ErrorResponseDto = {
      success: false,
      statusCode: status,
      code: HttpStatus[status] ?? 'HTTP_ERROR',
      message,
      requestId: String(req.id),
      timestamp: new Date().toISOString(),
      path: requestPath(req.originalUrl ?? req.url),
    };
    if (status === 400 && Array.isArray(details.issues)) {
      body.issues = details.issues
        .filter(
          (issue): issue is Record<string, string> =>
            typeof issue === 'object' &&
            issue !== null &&
            typeof issue.code === 'string' &&
            typeof issue.path === 'string' &&
            typeof issue.message === 'string',
        )
        .map(({ code, path, message }) => ({ code: code!, path: path!, message: message! }));
    }
    if (
      status === 503 &&
      details.status === 'error' &&
      details.service === 'smartsite-backend' &&
      details.database === 'down'
    ) {
      body.status = 'error';
      body.service = 'smartsite-backend';
      body.database = 'down';
    }
    // pino-http writes this once at response completion through the safe err serializer.
    res.err = exception instanceof Error ? exception : new Error('Request failed');
    res.status(status).json(body);
  }
}
