import { HttpException, HttpStatus } from '@nestjs/common';

export const BACKEND_ERROR_CODES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'RATE_LIMIT_EXCEEDED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_SERVER_ERROR',
  'HTTP_ERROR',
  'VALIDATION_FAILED',
  'INVALID_JSON',
  'AI_EVENT_ID_CONFLICT',
  'AI_INGESTION_UNAVAILABLE',
  'DATABASE_UNAVAILABLE',
] as const;

export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];

export interface PublicValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface PublicErrorPayload {
  code: BackendErrorCode;
  message: string;
  issues?: PublicValidationIssue[];
  status?: 'error';
  service?: 'smartsite-backend';
  database?: 'down';
}

const defaults = new Map<number, Pick<PublicErrorPayload, 'code' | 'message'>>([
  [HttpStatus.BAD_REQUEST, { code: 'BAD_REQUEST', message: 'Bad request' }],
  [HttpStatus.UNAUTHORIZED, { code: 'UNAUTHORIZED', message: 'Unauthorized' }],
  [HttpStatus.FORBIDDEN, { code: 'FORBIDDEN', message: 'Forbidden' }],
  [HttpStatus.NOT_FOUND, { code: 'NOT_FOUND', message: 'Not found' }],
  [HttpStatus.CONFLICT, { code: 'CONFLICT', message: 'Conflict' }],
  [HttpStatus.PAYLOAD_TOO_LARGE, { code: 'PAYLOAD_TOO_LARGE', message: 'Payload too large' }],
  [
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type' },
  ],
  [HttpStatus.TOO_MANY_REQUESTS, { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' }],
  [HttpStatus.SERVICE_UNAVAILABLE, { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' }],
  [
    HttpStatus.INTERNAL_SERVER_ERROR,
    { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
  ],
]);

export function defaultPublicError(status: number): Pick<PublicErrorPayload, 'code' | 'message'> {
  return defaults.get(status) ?? { code: 'HTTP_ERROR', message: 'Request failed' };
}

export class PublicHttpException extends HttpException {
  constructor(
    status: number,
    readonly publicPayload: PublicErrorPayload,
  ) {
    super(publicPayload, status);
  }
}
