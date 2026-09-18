export const CONTRACTS_VERSION = '1.0.0';

export {
  canonicalizeJson,
  computeCanonicalPayloadHash,
} from './hashing/canonical-hash.js';

export {
  validateGeometries,
} from './validation/geometry-validator.js';

export type {
  ValidationIssue,
} from './validation/geometry-validator.js';

export {
  validateObservationEvent,
} from './validation/schema-validator.js';

export type {
  ValidationResult,
} from './validation/schema-validator.js';
