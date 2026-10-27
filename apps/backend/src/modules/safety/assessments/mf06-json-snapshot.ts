type Row = Record<string, unknown>;

/** Bounded descriptor copy: never execute caller JSON hooks or retain mutable caller references. */
export function snapshotMf06Json(value: unknown): unknown {
  const seen = new Set<object>();
  let nodes = 0,
    text = 0;
  function copy(current: unknown, depth: number): unknown {
    if (++nodes > 100_000 || depth > 32) throw new Error('Input resource bound');
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'string') {
      text += current.length;
      if (text > 2_097_152) throw new Error('Input byte bound');
      return current;
    }
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current !== 'object' || current === null || seen.has(current))
      throw new Error('Input is not JSON data');
    const array = Array.isArray(current);
    if (
      Object.getPrototypeOf(current) !== (array ? Array.prototype : Object.prototype) &&
      Object.getPrototypeOf(current) !== null
    )
      throw new Error('Input prototype');
    if (Object.getOwnPropertySymbols(current).length) throw new Error('Input symbols');
    seen.add(current);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const result: Row | unknown[] = array ? [] : {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === 'length') continue;
      if (
        !descriptor.enumerable ||
        !('value' in descriptor) ||
        ['toJSON', '__proto__', 'constructor', 'prototype'].includes(key)
      )
        throw new Error('Input descriptor');
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= (current as unknown[]).length))
        throw new Error('Array property');
      (result as Row)[key] = copy(descriptor.value, depth + 1);
    }
    if (array && Object.keys(result).length !== (current as unknown[]).length)
      throw new Error('Sparse array');
    seen.delete(current);
    return result;
  }
  const result = copy(value, 0);
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 2_097_152)
    throw new Error('Input byte bound');
  return result;
}
