import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import type { ValidationIssue, ValidationResult } from './validation/schema-validator.js';

interface ConfigurationAcknowledgementBinding {
  readonly commandId: string;
  readonly workerGenerationId: string;
  readonly streamSessionId: string;
  readonly configurationVersion: number;
  readonly bundleSha256: string;
  readonly viewRevision: number;
}

/** Transport only; ownership, issuance, freshness and application require server validation. */
export type CameraConfigurationAcknowledgement = ConfigurationAcknowledgementBinding &
  (
    | { readonly outcome: 'LOADED'; readonly reasonCode?: never }
    | { readonly outcome: 'REJECTED'; readonly reasonCode?: string }
  );

export interface CameraConfigurationAcknowledgementValidationResult extends ValidationResult {
  value?: CameraConfigurationAcknowledgement;
}

export const MAX_CAMERA_CONFIGURATION_ACK_BYTES = 4096;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUIRED_KEYS: readonly string[] = [
  'commandId',
  'workerGenerationId',
  'streamSessionId',
  'configurationVersion',
  'bundleSha256',
  'viewRevision',
  'outcome',
];

function invalid(
  code: ValidationIssue['code'],
): CameraConfigurationAcknowledgementValidationResult {
  return {
    isValid: false,
    issues: [{ code, path: '/', message: 'Invalid configuration acknowledgement' }],
  };
}

/** A valid shape must still be matched against server-issued bundle and generation state. */
export function parseCameraConfigurationAcknowledgementPayload(
  payload: string | Uint8Array,
): CameraConfigurationAcknowledgementValidationResult {
  const size =
    typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
  if (size > MAX_CAMERA_CONFIGURATION_ACK_BYTES) return invalid('PAYLOAD_TOO_LARGE');
  let data: unknown;
  try {
    data = JSON.parse(
      typeof payload === 'string'
        ? payload
        : new TextDecoder('utf-8', { fatal: true }).decode(payload),
    );
  } catch {
    return invalid('INVALID_JSON');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data))
    return invalid('SCHEMA_VIOLATION');
  const value = data as Record<string, unknown>;
  if (
    !REQUIRED_KEYS.every((key) => Object.hasOwn(value, key)) ||
    !Object.keys(value).every(
      (key) =>
        REQUIRED_KEYS.includes(key) || (key === 'reasonCode' && value.outcome === 'REJECTED'),
    ) ||
    !['commandId', 'workerGenerationId', 'streamSessionId'].every(
      (key) => typeof value[key] === 'string' && UUID.test(value[key]),
    ) ||
    !['configurationVersion', 'viewRevision'].every(
      (key) =>
        typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] >= 1,
    ) ||
    typeof value.bundleSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.bundleSha256) ||
    (value.outcome !== 'LOADED' && value.outcome !== 'REJECTED') ||
    (Object.hasOwn(value, 'reasonCode') &&
      (typeof value.reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(value.reasonCode)))
  )
    return invalid('SCHEMA_VIOLATION');
  return {
    isValid: true,
    issues: [],
    value: value as unknown as CameraConfigurationAcknowledgement,
  };
}
