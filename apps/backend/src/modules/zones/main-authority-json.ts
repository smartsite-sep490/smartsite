const MAX_BYTES = 2 * 1024 * 1024;
const MAX_JSON_NODES = 100000;
const MAX_DEPTH = 32;
export class ArchiveInputError extends Error {
  constructor(readonly reason: 'RESOURCE_LIMIT' | 'MALFORMED_ARCHIVE') {
    super(reason);
  }
}
type Json = null | boolean | string | number | Json[] | { [key: string]: Json };
function materialize(
  value: unknown,
  budget = { nodes: 0, bytes: 0 },
  ancestors = new Set<object>(),
  depth = 0,
): Json {
  if (++budget.nodes > MAX_JSON_NODES || depth > MAX_DEPTH)
    throw new ArchiveInputError('RESOURCE_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_BYTES) throw new ArchiveInputError('RESOURCE_LIMIT');
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (budget.bytes > MAX_BYTES) throw new ArchiveInputError('RESOURCE_LIMIT');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw new ArchiveInputError('MALFORMED_ARCHIVE');
    return value;
  }
  if (typeof value !== 'object') throw new ArchiveInputError('MALFORMED_ARCHIVE');
  const array = Array.isArray(value),
    proto = Object.getPrototypeOf(value);
  if (
    (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) ||
    ancestors.has(value) ||
    Object.getOwnPropertySymbols(value).length
  )
    throw new ArchiveInputError('MALFORMED_ARCHIVE');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors.length?.value as unknown;
      if (
        typeof length !== 'number' ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_JSON_NODES
      )
        throw new ArchiveInputError('RESOURCE_LIMIT');
      if (Object.keys(descriptors).length !== length + 1)
        throw new ArchiveInputError('MALFORMED_ARCHIVE');
      const copy: Json[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
          throw new ArchiveInputError('MALFORMED_ARCHIVE');
        copy.push(materialize(descriptor.value, budget, ancestors, depth + 1));
      }
      return copy;
    }
    const copy: { [key: string]: Json } = Object.create(null) as { [key: string]: Json };
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (
        ['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key) ||
        !descriptor.enumerable ||
        !('value' in descriptor)
      )
        throw new ArchiveInputError('MALFORMED_ARCHIVE');
      budget.bytes += Buffer.byteLength(key, 'utf8');
      if (budget.bytes > MAX_BYTES) throw new ArchiveInputError('RESOURCE_LIMIT');
      copy[key] = materialize(descriptor.value, budget, ancestors, depth + 1);
    }
    return copy;
  } finally {
    ancestors.delete(value);
  }
}
export function safeInput(value: unknown): Json {
  const copy = materialize(value);
  if (Buffer.byteLength(JSON.stringify(copy), 'utf8') > MAX_BYTES)
    throw new ArchiveInputError('RESOURCE_LIMIT');
  return copy;
}
