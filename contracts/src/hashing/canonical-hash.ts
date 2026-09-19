import { createHash } from 'node:crypto';
import canonicalizePkg from 'canonicalize';

type CanonicalizeFn = (input: unknown) => string | undefined;

const canonicalize: CanonicalizeFn =
  typeof canonicalizePkg === 'function'
    ? (canonicalizePkg as CanonicalizeFn)
    : (canonicalizePkg as unknown as { default: CanonicalizeFn }).default;

function assertInteroperableIntegers(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw new TypeError(`Integer ${value} is outside the interoperable JSON safe integer domain`);
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  const nestedValues = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  for (const nestedValue of nestedValues) {
    assertInteroperableIntegers(nestedValue, seen);
  }
}

export function canonicalizeJson(payload: unknown): string {
  if (payload === undefined) {
    throw new TypeError('Payload cannot be canonicalized as RFC 8785 JSON');
  }
  if (typeof payload === 'function' || typeof payload === 'symbol') {
    throw new TypeError(`Cannot canonicalize value of type ${typeof payload}`);
  }

  assertInteroperableIntegers(payload);

  let result: string | undefined;
  try {
    result = canonicalize(payload);
  } catch (err: unknown) {
    if (err instanceof RangeError) {
      throw new TypeError('Cannot canonicalize cyclical structure: circular reference detected', {
        cause: err,
      });
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
