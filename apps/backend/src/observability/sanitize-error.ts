import { EnvironmentValidationError } from '../config/environment.js';

/** Error text can contain SQL, evidence or credentials; retain only diagnostic metadata. */
export function sanitizeError(error: unknown, depth = 0): Record<string, unknown> {
  if (typeof error !== 'object' || error === null) return { type: 'Error' };
  const value = error as Record<string, unknown>;
  const type =
    typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.name)
      ? value.name
      : 'Error';
  const result: Record<string, unknown> = { type, message: 'Error details omitted' };
  if (typeof value.code === 'string' && /^(?:[0-9A-Z]{5}|E[A-Z_]{2,40})$/.test(value.code)) {
    result.code = value.code;
  }
  if (error instanceof EnvironmentValidationError) result.issues = error.issues;
  if (typeof value.stack === 'string') {
    result.stack = value.stack
      .split('\n')
      .slice(1)
      .filter((line) => /^\s+at /.test(line))
      .flatMap((line) => line.match(/[A-Za-z0-9_.-]+\.[cm]?[jt]s:\d+:\d+(?=\)?$)/) ?? [])
      .slice(0, 12);
  }
  if (depth < 2 && value.cause !== undefined) result.cause = sanitizeError(value.cause, depth + 1);
  return result;
}
