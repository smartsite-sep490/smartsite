import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { requestPath } from './request-id.js';
import type { ErrorResponseDto } from './error-response.dto.js';
import {
  defaultPublicError,
  PublicHttpException,
  type PublicErrorPayload,
} from './public-http-exception.js';

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
      const payload =
        parserError.type === 'entity.parse.failed'
          ? { code: 'INVALID_JSON' as const, message: 'Invalid JSON payload' }
          : defaultPublicError(status);
      return next(new PublicHttpException(status, payload));
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
    const candidateStatus = exception instanceof HttpException ? exception.getStatus() : 500;
    const status =
      Number.isInteger(candidateStatus) && candidateStatus >= 400 && candidateStatus <= 599
        ? candidateStatus
        : 500;
    const details: PublicErrorPayload =
      exception instanceof PublicHttpException
        ? exception.publicPayload
        : defaultPublicError(status);
    const body: ErrorResponseDto = {
      success: false,
      statusCode: status,
      code: details.code,
      message: details.message,
      requestId: String(req.id),
      timestamp: new Date().toISOString(),
      path: requestPath(req.originalUrl ?? req.url),
    };
    if (details.issues) body.issues = details.issues;
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
