import { createHash } from 'node:crypto';
import canonicalizePkg from 'canonicalize';

type CanonicalizeFn = (input: unknown) => string | undefined;

const canonicalize: CanonicalizeFn =
  typeof canonicalizePkg === 'function'
    ? (canonicalizePkg as CanonicalizeFn)
    : (canonicalizePkg as unknown as { default: CanonicalizeFn }).default;

export function canonicalizeJson(payload: unknown): string {
  if (payload === undefined) {
    throw new TypeError('Payload cannot be canonicalized as RFC 8785 JSON');
  }
  if (typeof payload === 'function' || typeof payload === 'symbol') {
    throw new TypeError(`Cannot canonicalize value of type ${typeof payload}`);
  }

  let result: string | undefined;
  try {
    result = canonicalize(payload);
  } catch (err: unknown) {
    if (err instanceof RangeError) {
      throw new TypeError('Cannot canonicalize cyclical structure: circular reference detected', { cause: err });
    }
    throw err;
  }

  if (result === undefined) {
    throw new TypeError('Payload cannot be canonicalized as RFC 8785 JSON');
  }

  return result;
}

export function computeCanonicalPayloadHash(payload: unknown): string {
  const canonicalJson = canonicalizeJson(payload);
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
