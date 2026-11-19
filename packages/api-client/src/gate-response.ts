import type { GateResponse, GateSourceResponse, PublicGateResponse } from '@smartsite/contracts';
import { ApiError } from './errors';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function label(
  value: unknown,
): value is Record<string, unknown> & { id: string; code: string; name: string } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    uuid.test(record.id) &&
    typeof record.code === 'string' &&
    record.code.length > 0 &&
    record.code.length <= 64 &&
    typeof record.name === 'string' &&
    record.name.trim().length > 0 &&
    record.name.length <= 100
  );
}
export function validGate(value: unknown, siteId: string): value is GateResponse {
  if (!label(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return record.siteId === siteId && (record.status === 'ACTIVE' || record.status === 'INACTIVE');
}
export function parseGateSources(
  value: unknown,
  siteId: string,
  gateId: string,
): { items: GateSourceResponse[] } {
  const items =
    value && typeof value === 'object' ? (value as Record<string, unknown>).items : undefined;
  if (
    !Array.isArray(items) ||
    items.some((item) => !label(item) || item.siteId !== siteId || item.gateId !== gateId)
  )
    throw new ApiError('invalid-response', 'Invalid Gate source catalog');
  return { items: items as GateSourceResponse[] };
}

export function parsePublicGates(value: unknown): { items: PublicGateResponse[] } {
  const items =
    value && typeof value === 'object' ? (value as Record<string, unknown>).items : undefined;
  if (!Array.isArray(items) || items.some((item) => !label(item)))
    throw new ApiError('invalid-response', 'Invalid public Gate catalog');
  return { items: items.map(({ id, code, name }) => ({ id, code, name })) };
}
