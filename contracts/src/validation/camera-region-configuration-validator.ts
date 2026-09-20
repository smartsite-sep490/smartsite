import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import type { CameraRegionConfiguration } from '../camera-region-configuration.js';
import { validateCameraRegionPolygons } from './polygon-validator.js';
import { validateCameraRegionConfiguration } from './schema-validator.js';
import type { ValidationResult } from './schema-validator.js';

export const MAX_CAMERA_REGION_PAYLOAD_BYTES = 262_144;

export interface CameraRegionConfigurationValidationResult extends ValidationResult {
  value?: CameraRegionConfiguration;
}

export function parseCameraRegionConfigurationPayload(
  payload: string | Uint8Array,
): CameraRegionConfigurationValidationResult {
  const byteLength =
    typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
  if (byteLength > MAX_CAMERA_REGION_PAYLOAD_BYTES) {
    return {
      isValid: false,
      issues: [
        { code: 'PAYLOAD_TOO_LARGE', path: '/', message: 'Payload exceeds 262144 UTF-8 bytes' },
      ],
    };
  }

  let data: unknown;
  try {
    const json =
      typeof payload === 'string'
        ? payload
        : new TextDecoder('utf-8', { fatal: true }).decode(payload);
    data = JSON.parse(json);
  } catch {
    return {
      isValid: false,
      issues: [{ code: 'INVALID_JSON', path: '/', message: 'Payload must be valid UTF-8 JSON' }],
    };
  }

  const schemaResult = validateCameraRegionConfiguration(data);
  if (!schemaResult.isValid) return schemaResult;

  const value = data as CameraRegionConfiguration;
  const issues = validateCameraRegionPolygons(value);
  if (issues.length > 0) return { isValid: false, issues };

  return { isValid: true, issues: [], value };
}
