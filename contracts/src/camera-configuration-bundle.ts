import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import type { CameraObservationRegionConfiguration } from './camera-region-configuration.js';
import { PPE_ITEMS, type PpeItem } from './ppe-items.js';
import { computeCanonicalPayloadHash } from './hashing/canonical-hash.js';
import {
  MAX_CAMERA_REGION_PAYLOAD_BYTES,
  parseCameraRegionConfigurationPayload,
} from './validation/camera-region-configuration-validator.js';
import type { ValidationIssue, ValidationResult } from './validation/schema-validator.js';

/** Immutable transport preparation; a matching hash proves neither authority nor worker application. */
export interface CameraConfigurationBundle {
  readonly schemaVersion: '1.0.0';
  readonly cameraId: string;
  readonly cameraExternalId: string;
  readonly configurationVersion: number;
  readonly viewRevision: number;
  readonly issuedAt: string;
  readonly bundleSha256: string;
  readonly regions: readonly CameraConfigurationBundleRegion[];
}

export interface CameraConfigurationBundleRegion extends CameraObservationRegionConfiguration {
  readonly zoneId: string;
  readonly policyRevision: number;
  readonly requiredPpe: readonly PpeItem[];
}

export interface CameraConfigurationBundleValidationResult extends ValidationResult {
  value?: CameraConfigurationBundle;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BUNDLE_KEYS = [
  'schemaVersion',
  'cameraId',
  'cameraExternalId',
  'configurationVersion',
  'viewRevision',
  'issuedAt',
  'bundleSha256',
  'regions',
] as const;
const REGION_KEYS = [
  'regionId',
  'geometryVersion',
  'coordinateSpace',
  'polygon',
  'zoneId',
  'policyRevision',
  'requiredPpe',
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}
function version(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function invalid(code: ValidationIssue['code']): CameraConfigurationBundleValidationResult {
  return {
    isValid: false,
    issues: [{ code, path: '/', message: 'Invalid camera configuration bundle' }],
  };
}

/** SHA covers every field except bundleSha256; array order is part of the immutable content. */
export function parseCameraConfigurationBundlePayload(
  payload: string | Uint8Array,
): CameraConfigurationBundleValidationResult {
  const size =
    typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
  if (size > MAX_CAMERA_REGION_PAYLOAD_BYTES) return invalid('PAYLOAD_TOO_LARGE');
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
  if (
    !record(data) ||
    !exact(data, BUNDLE_KEYS) ||
    data.schemaVersion !== '1.0.0' ||
    typeof data.cameraId !== 'string' ||
    !UUID.test(data.cameraId) ||
    !version(data.configurationVersion) ||
    !version(data.viewRevision) ||
    typeof data.issuedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.issuedAt) ||
    !Number.isFinite(Date.parse(data.issuedAt)) ||
    new Date(data.issuedAt).toISOString() !== data.issuedAt ||
    typeof data.bundleSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(data.bundleSha256) ||
    !Array.isArray(data.regions) ||
    data.regions.length > 64
  )
    return invalid('SCHEMA_VIOLATION');

  const ids = new Set<string>();
  for (const region of data.regions) {
    if (
      !record(region) ||
      !exact(region, REGION_KEYS) ||
      typeof region.regionId !== 'string' ||
      !UUID.test(region.regionId) ||
      ids.has(region.regionId) ||
      typeof region.zoneId !== 'string' ||
      !UUID.test(region.zoneId) ||
      !version(region.policyRevision) ||
      !Array.isArray(region.requiredPpe) ||
      region.requiredPpe.length > PPE_ITEMS.length ||
      new Set(region.requiredPpe).size !== region.requiredPpe.length ||
      !region.requiredPpe.every((item) => PPE_ITEMS.includes(item))
    )
      return invalid('SCHEMA_VIOLATION');
    ids.add(region.regionId);
  }
  try {
    const geometry = parseCameraRegionConfigurationPayload(
      JSON.stringify({
        schemaVersion: data.schemaVersion,
        configurationVersion: data.configurationVersion,
        cameraExternalId: data.cameraExternalId,
        regions: data.regions.map((region) => ({
          regionId: region.regionId,
          geometryVersion: region.geometryVersion,
          coordinateSpace: region.coordinateSpace,
          polygon: region.polygon,
        })),
      }),
    );
    if (!geometry.isValid) return { isValid: false, issues: geometry.issues };
    const { bundleSha256, ...content } = data;
    if (computeCanonicalPayloadHash(content) !== bundleSha256) return invalid('SCHEMA_VIOLATION');
    return { isValid: true, issues: [], value: data as unknown as CameraConfigurationBundle };
  } catch {
    // Deep untrusted JSON must fail validation rather than escape through serialization.
    return invalid('SCHEMA_VIOLATION');
  }
}
