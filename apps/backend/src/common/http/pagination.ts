import { page } from '../configuration/commands.js';

function parameter(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : /^\d+$/.test(value) ? Number(value) : NaN;
}

export function pagination(offset?: string, limit?: string) {
  return page(parameter(offset, 0), parameter(limit, 20));
}
