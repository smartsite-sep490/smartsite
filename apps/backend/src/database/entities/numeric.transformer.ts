import type { ValueTransformer } from 'typeorm';

export const numericTransformer: ValueTransformer = {
  to(value: number | string | null | undefined): number | null | undefined {
    if (value === null || value === undefined) {
      return value;
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
      throw new TypeError(`Expected finite number, received: ${String(value)}`);
    }
    return num;
  },
  from(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) {
      throw new TypeError(`Expected finite number from database, received: ${String(value)}`);
    }
    return num;
  },
};
