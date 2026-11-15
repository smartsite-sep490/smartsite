import { Buffer } from 'node:buffer';
import { computeCanonicalPayloadHash } from './hashing/canonical-hash.js';
import {
  validateObservationEvent,
  validatePartitionedObservationEvent,
} from './validation/schema-validator.js';

/** Producer claim only; Backend must authenticate and match issued immutable state. */
export interface WorkerEventDeliveryContext {
  readonly schemaVersion: '1.0.0';
  readonly cameraId: string;
  readonly workerGenerationId: string;
  readonly streamSessionId: string;
  readonly configurationVersion: number;
  readonly bundleSha256: string;
  readonly viewRevision: number;
  readonly receiptCommandId: string;
  readonly sourceKind: 'LIVE' | 'REPLAY';
}

export interface WorkerEventDeliveryEnvelope {
  readonly schemaVersion: '1.0.0';
  readonly context: WorkerEventDeliveryContext;
  readonly event: Readonly<Record<string, unknown>>;
}

const keys = [
  'schemaVersion',
  'cameraId',
  'workerGenerationId',
  'streamSessionId',
  'configurationVersion',
  'bundleSha256',
  'viewRevision',
  'receiptCommandId',
  'sourceKind',
];
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const hash = /^[a-f0-9]{64}$/;
function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return (
    Reflect.ownKeys(value).length === fields.length &&
    fields.every((key) => Object.hasOwn(value, key))
  );
}

export function parseWorkerEventDeliveryContext(value: unknown): WorkerEventDeliveryContext | null {
  if (
    !object(value) ||
    !exact(value, keys) ||
    value.schemaVersion !== '1.0.0' ||
    !['cameraId', 'workerGenerationId', 'streamSessionId', 'receiptCommandId'].every(
      (key) => typeof value[key] === 'string' && uuid.test(value[key]),
    ) ||
    !['configurationVersion', 'viewRevision'].every(
      (key) =>
        typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 1,
    ) ||
    typeof value.bundleSha256 !== 'string' ||
    !hash.test(value.bundleSha256) ||
    (value.sourceKind !== 'LIVE' && value.sourceKind !== 'REPLAY')
  )
    return null;
  return { ...value } as unknown as WorkerEventDeliveryContext;
}

/** Envelope budget is shared with event content; raw event remains unchanged. */
export function parseWorkerEventDeliveryEnvelope(
  value: unknown,
): WorkerEventDeliveryEnvelope | null {
  try {
    if (
      !object(value) ||
      !exact(value, ['schemaVersion', 'context', 'event']) ||
      value.schemaVersion !== '1.0.0'
    )
      return null;
    const context = parseWorkerEventDeliveryContext(value.context);
    if (!context || !object(value.event) || value.event.streamSessionId !== context.streamSessionId)
      return null;
    const validation =
      value.event.schemaVersion === '1.4.0'
        ? validatePartitionedObservationEvent(value.event)
        : validateObservationEvent(value.event);
    if (!validation.isValid) return null;
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) return null;
    const copy: Record<string, unknown> = JSON.parse(serialized);
    return { schemaVersion: '1.0.0', context, event: copy.event as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Raw payload hash stays distinct from the digest binding original execution context. */
export function computeWorkerEventBindingHash(
  eventPayloadHash: string,
  input: WorkerEventDeliveryContext,
): string {
  const context = parseWorkerEventDeliveryContext(input);
  if (typeof eventPayloadHash !== 'string' || !hash.test(eventPayloadHash) || !context)
    throw new Error('Invalid worker event binding');
  return computeCanonicalPayloadHash({ eventPayloadHash, context });
}
