/** Internal driver classification only; never expose raw error text or infer business outcomes. */
export function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as {
    code?: unknown;
    driverError?: { code?: unknown };
    cause?: { code?: unknown };
  };
  const code = candidate.driverError?.code ?? candidate.cause?.code ?? candidate.code;
  return typeof code === 'string' ? code : undefined;
}

export function isDatabaseConnectionFailure(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return Boolean(
    code &&
    (code.startsWith('08') ||
      [
        '57P01',
        '57P02',
        '57P03',
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EHOSTUNREACH',
      ].includes(code)),
  );
}

export function isTransientDatabaseFailure(error: unknown): boolean {
  const code = databaseErrorCode(error);
  return (
    isDatabaseConnectionFailure(error) ||
    (code !== undefined && ['40001', '40P01', '55P03', '57014', '55000'].includes(code))
  );
}
