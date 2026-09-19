export const CONTRACTS_VERSION = '1.0.0';

export { canonicalizeJson, computeCanonicalPayloadHash } from './hashing/canonical-hash.js';

export { validateGeometries } from './validation/geometry-validator.js';

export type { ValidationIssue } from './validation/geometry-validator.js';

export { validateObservationEvent } from './validation/schema-validator.js';

export { validateCameraRegionConfiguration } from './validation/schema-validator.js';

export type { ValidationResult } from './validation/schema-validator.js';

export {
  MAX_CAMERA_REGION_PAYLOAD_BYTES,
  parseCameraRegionConfigurationPayload,
} from './validation/camera-region-configuration-validator.js';

export type { CameraRegionConfigurationValidationResult } from './validation/camera-region-configuration-validator.js';

export type {
  CameraObservationRegionConfiguration,
  CameraRegionConfiguration,
  NormalizedCoordinate,
} from './camera-region-configuration.js';
