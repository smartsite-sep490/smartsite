import crypto from 'node:crypto';
import canonicalizePkg from 'canonicalize';

type CanonicalizeFn = (input: unknown) => string | undefined;

const canonicalize: CanonicalizeFn =
  typeof canonicalizePkg === 'function'
    ? (canonicalizePkg as CanonicalizeFn)
    : (canonicalizePkg as unknown as { default: CanonicalizeFn }).default;

/**
 * Serializes a JSON-compatible value to an RFC 8785 JSON Canonicalization Scheme (JCS) string.
 *
 * Requirements:
 * - Deterministically sorts object keys according to UTF-16 code units.
 * - Strictly preserves array element order (does NOT sort arrays).
 * - Suppresses insignificant whitespace.
 * - Rejects non-JSON serializable values (undefined, functions, symbols, circular references).
 */
export function canonicalizeJson(payload: unknown): string {
  if (payload === undefined) {
    throw new TypeError('Cannot canonicalize undefined value');
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
    throw new TypeError('Failed to canonicalize payload: value is not JSON-serializable');
  }

  return result;
}

/**
 * Computes a deterministic SHA-256 hash (lowercase hex) of an RFC 8785 canonicalized JSON payload.
 */
export function computeCanonicalPayloadHash(payload: unknown): string {
  const canonicalString = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}
