import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type {} from 'pino-http';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const values: string[] = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === 'x-request-id') {
      values.push(req.rawHeaders[index + 1] ?? '');
    }
  }
  const candidate = values.length === 1 ? values[0] : undefined;
  req.id =
    candidate && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate) ? candidate : randomUUID();
  res.setHeader('X-Request-Id', String(req.id));
  next();
}

export function requestPath(url: string | undefined): string {
  return (url ?? '/').split('?')[0] ?? '/';
}
