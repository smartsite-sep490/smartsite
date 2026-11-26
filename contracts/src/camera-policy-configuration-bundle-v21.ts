import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import {
  parseCameraConfigurationBundlePayload,
  type CameraConfigurationBundle,
  type CameraConfigurationBundleRegion,
} from './camera-configuration-bundle.js';
import { parseRegionPpePolicy } from './camera-ppe-policy.js';
import { computeCanonicalPayloadHash } from './hashing/canonical-hash.js';
import { MAX_CAMERA_REGION_PAYLOAD_BYTES } from './validation/camera-region-configuration-validator.js';
import type { ValidationIssue, ValidationResult } from './validation/schema-validator.js';

/** Explicit new-version policy vocabulary; never widens the existing five-item defaults. */
export const CAMERA_POLICY_PPE_ITEMS_V21 = Object.freeze([
  'HARD_HAT',
  'SAFETY_VEST',
  'GLOVES',
  'BOOTS',
  'GOGGLES',
  'MASK',
] as const);
export type CameraPolicyPpeItemV21 = (typeof CAMERA_POLICY_PPE_ITEMS_V21)[number];
export type CameraPpePolicyV21 =
  | { readonly mode: 'EXPLICIT'; readonly requiredPpe: readonly CameraPolicyPpeItemV21[] }
  | { readonly mode: 'DISABLED'; readonly reason: string };
export type RegionPpePolicyV21 = CameraPpePolicyV21 | { readonly mode: 'INHERIT' };

export interface CameraPolicyConfigurationBundleRegionV21 extends Omit<
  CameraConfigurationBundleRegion,
  'requiredPpe'
> {
  readonly ppePolicy: RegionPpePolicyV21;
}

export interface CameraPolicyConfigurationBundleV21 extends Omit<
  CameraConfigurationBundle,
  'schemaVersion' | 'regions'
> {
  readonly schemaVersion: '2.1.0';
  readonly cameraPpePolicy: CameraPpePolicyV21;
  readonly regions: readonly CameraPolicyConfigurationBundleRegionV21[];
}

export interface CameraPolicyConfigurationBundleValidationResultV21 extends ValidationResult {
  value?: CameraPolicyConfigurationBundleV21;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function validPolicy(value: unknown, allowInherit: boolean): boolean {
  if (!record(value)) return false;
  if (value.mode !== 'EXPLICIT') {
    const policy = parseRegionPpePolicy(value);
    return policy !== null && (allowInherit || policy.mode !== 'INHERIT');
  }
  const items = value.requiredPpe;
  return (
    Object.keys(value).length === 2 &&
    Object.hasOwn(value, 'mode') &&
    Object.hasOwn(value, 'requiredPpe') &&
    Array.isArray(items) &&
    items.length >= 1 &&
    items.length <= CAMERA_POLICY_PPE_ITEMS_V21.length &&
    new Set(items).size === items.length &&
    items.every((item) => CAMERA_POLICY_PPE_ITEMS_V21.includes(item))
  );
}

function invalid(
  code: ValidationIssue['code'] = 'SCHEMA_VIOLATION',
): CameraPolicyConfigurationBundleValidationResultV21 {
  return {
    isValid: false,
    issues: [{ code, path: '/', message: 'Invalid v2.1 camera policy bundle' }],
  };
}

/** Called only after JSON.parse succeeds; track decoded keys independently per object. */
function hasDuplicateJsonKeys(text: string): boolean {
  const stack: ({ keys: Set<string>; expectingKey: boolean } | null)[] = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    const current = stack.at(-1);
    if (token === '{') stack.push({ keys: new Set(), expectingKey: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ':' && current) current.expectingKey = false;
    else if (token === ',' && current) current.expectingKey = true;
    else if (token.startsWith('"') && current?.expectingKey) {
      const key = JSON.parse(token) as string;
      if (current.keys.has(key)) return true;
      current.keys.add(key);
    }
  }
  return false;
}

/** Hash/shape preparation only; callers still own Site authority, issuance and worker capability. */
export function parseCameraPolicyConfigurationBundleV21Payload(
  payload: string | Uint8Array,
): CameraPolicyConfigurationBundleValidationResultV21 {
  if (typeof payload !== 'string' && !(payload instanceof Uint8Array))
    return invalid('INVALID_JSON');
  const size =
    typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
  if (size > MAX_CAMERA_REGION_PAYLOAD_BYTES) return invalid('PAYLOAD_TOO_LARGE');
  let data: unknown;
  try {
    const text =
      typeof payload === 'string'
        ? payload
        : new TextDecoder('utf-8', { fatal: true }).decode(payload);
    data = JSON.parse(text);
    if (hasDuplicateJsonKeys(text)) return invalid('INVALID_JSON');
  } catch {
    return invalid('INVALID_JSON');
  }
  if (
    !record(data) ||
    data.schemaVersion !== '2.1.0' ||
    !validPolicy(data.cameraPpePolicy, false) ||
    !Array.isArray(data.regions) ||
    data.regions.length > 64
  )
    return invalid();
  const regions: Record<string, unknown>[] = [];
  for (const region of data.regions) {
    if (
      !record(region) ||
      Object.hasOwn(region, 'requiredPpe') ||
      !validPolicy(region.ppePolicy, true)
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
    // Internal geometry-only projection follows v2.0. Its empty PPE placeholders
    // never become returned policy, migrated data or proof that PPE is disabled.
    const geometryEnvelope = { ...common, schemaVersion: '1.0.0', regions };
    const metadata = parseCameraConfigurationBundlePayload(
      JSON.stringify({
        ...geometryEnvelope,
        bundleSha256: computeCanonicalPayloadHash(geometryEnvelope),
      }),
    );
    if (!metadata.isValid) return { isValid: false, issues: metadata.issues };
    return {
      isValid: true,
      issues: [],
      value: data as unknown as CameraPolicyConfigurationBundleV21,
    };
  } catch {
    return invalid();
  }
}
