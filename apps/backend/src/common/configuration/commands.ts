import { HttpStatus } from '@nestjs/common';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { isUUID, validateSync } from 'class-validator';
import { QueryFailedError } from 'typeorm';
import { PublicHttpException, type PublicValidationIssue } from '../http/public-http-exception.js';
import { validationIssues } from '../http/validation-issues.js';

export function invalid(
  message = 'Invalid configuration input',
  issues?: PublicValidationIssue[],
): never {
  throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
    code: 'VALIDATION_FAILED',
    message,
    ...(issues ? { issues } : {}),
  });
}

export function missing(): never {
  throw new PublicHttpException(HttpStatus.NOT_FOUND, {
    code: 'NOT_FOUND',
    message: 'Configuration resource not found',
  });
}

export function conflict(
  message = 'Configuration conflict',
  issues?: PublicValidationIssue[],
): never {
  throw new PublicHttpException(HttpStatus.CONFLICT, {
    code: 'CONFLICT',
    message,
    ...(issues ? { issues } : {}),
  });
}

export function command<T extends object>(type: ClassConstructor<T>, input: unknown): T {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const value = plainToInstance(type, input, { enableImplicitConversion: false });
  const errors = validateSync(value, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) invalid('Invalid configuration input', validationIssues(errors));
  return value;
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !isUUID(value)) invalid();
  return value;
}

export function page(offset = 0, limit = 20): { offset: number; limit: number } {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    invalid();
  return { offset, limit };
}

export function knownUnique(error: unknown, names: readonly string[]): never {
  if (error instanceof QueryFailedError) {
    const driver = error.driverError as { code?: string; constraint?: string };
    if (driver.code === '23505' && driver.constraint && names.includes(driver.constraint))
      conflict();
  }
  throw error;
}
