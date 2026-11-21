import type { Request } from 'express';
import { PublicHttpException } from '../../common/http/public-http-exception.js';

/** Reject repeated credentials rather than trusting the HTTP library's merged header value. */
export function readWorkerGenerationSecret(request: Request): string {
  const header = 'x-worker-generation-secret';
  const secret = request.headers[header];
  let occurrences = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === header) occurrences++;
  if (occurrences !== 1 || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new PublicHttpException(401, {
      code: 'UNAUTHORIZED',
      message: 'Worker credential is invalid',
    });
  return secret;
}
