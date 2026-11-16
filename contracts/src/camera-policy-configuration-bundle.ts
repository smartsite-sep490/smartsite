import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import {
  parseCameraConfigurationBundlePayload,
  type CameraConfigurationBundle,
  type CameraConfigurationBundleRegion,
} from './camera-configuration-bundle.js';
import {
  parseCameraPpePolicy,
  parseRegionPpePolicy,
  type CameraPpePolicy,
  type RegionPpePolicy,
} from './camera-ppe-policy.js';
import { computeCanonicalPayloadHash } from './hashing/canonical-hash.js';
import { MAX_CAMERA_REGION_PAYLOAD_BYTES } from './validation/camera-region-configuration-validator.js';
import type { ValidationIssue, ValidationResult } from './validation/schema-validator.js';

export interface CameraPolicyConfigurationBundleRegion extends Omit<
  CameraConfigurationBundleRegion,
  'requiredPpe'
> {
  /** Independent PPE binding; inherited policyRevision still identifies the Zone policy. */
  readonly ppePolicy: RegionPpePolicy;
}

export interface CameraPolicyConfigurationBundle extends Omit<
  CameraConfigurationBundle,
  'schemaVersion' | 'regions'
> {
  readonly schemaVersion: '2.0.0';
  readonly cameraPpePolicy: CameraPpePolicy;
  readonly regions: readonly CameraPolicyConfigurationBundleRegion[];
}

export interface CameraPolicyConfigurationBundleValidationResult extends ValidationResult {
  value?: CameraPolicyConfigurationBundle;
}

function invalid(
  code: ValidationIssue['code'] = 'SCHEMA_VIOLATION',
): CameraPolicyConfigurationBundleValidationResult {
  return { isValid: false, issues: [{ code, path: '/', message: 'Invalid camera policy bundle' }] };
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Preserves original content and hash. Does not authorize changes or imply worker application. */
export function parseCameraPolicyConfigurationBundlePayload(
  payload: string | Uint8Array,
): CameraPolicyConfigurationBundleValidationResult {
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
    data.schemaVersion !== '2.0.0' ||
    !parseCameraPpePolicy(data.cameraPpePolicy) ||
    !Array.isArray(data.regions) ||
    data.regions.length > 64
  )
    return invalid();
  const regions: Record<string, unknown>[] = [];
  for (const region of data.regions) {
    if (
      !record(region) ||
      Object.hasOwn(region, 'requiredPpe') ||
      !parseRegionPpePolicy(region.ppePolicy)
    )
      return invalid();
    const geometryAndZone = { ...region };
    Reflect.deleteProperty(geometryAndZone, 'ppePolicy');
    regions.push({ ...geometryAndZone, requiredPpe: [] });
  }
  try {
    const { bundleSha256, ...content } = data;
    if (computeCanonicalPayloadHash(content) !== bundleSha256) return invalid();
    const common = { ...content };
    Reflect.deleteProperty(common, 'cameraPpePolicy');
    // Reuse v1 metadata/geometry checks through an internal projection only.
    // Empty PPE here is a validation placeholder, never a migrated or returned policy.
    const geometryEnvelope = { ...common, schemaVersion: '1.0.0', regions };
    const metadata = parseCameraConfigurationBundlePayload(
      JSON.stringify({
        ...geometryEnvelope,
        bundleSha256: computeCanonicalPayloadHash(geometryEnvelope),
      }),
    );
    if (!metadata.isValid) return { isValid: false, issues: metadata.issues };
    return { isValid: true, issues: [], value: data as unknown as CameraPolicyConfigurationBundle };
  } catch {
    return invalid();
  }
}
