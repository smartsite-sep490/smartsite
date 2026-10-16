/** Archive-only metadata; absence must not infer Contractor from current membership. */
export function legacyContractorAnchor(row: object): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(row, 'contractorId');
  if (!descriptor) return null;
  if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    throw new Error('Legacy contractor anchor must be stored metadata');
  }
  const value: unknown = descriptor.value;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error('Legacy contractor anchor has an invalid value');
  return value;
}
