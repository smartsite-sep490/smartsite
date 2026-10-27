import { readFileSync } from 'node:fs';
import Ajv2020Pkg from 'ajv/dist/2020.js';
import addFormatsPkg from 'ajv-formats';
import { validateGeometries } from './geometry-validator.js';
import type { ValidationIssue } from './geometry-validator.js';

export type { ValidationIssue } from './geometry-validator.js';

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
}

export interface ObservationFramePartition {
  frameId: string;
  sequenceNumber: string;
  partIndex: number;
  partCount: number;
}

interface AjvValidationError {
  instancePath: string;
  message?: string;
  keyword: string;
  params: Record<string, unknown>;
}

interface CompiledSchemaValidator {
  (data: unknown): boolean;
  errors?: AjvValidationError[] | null;
}

interface Ajv2020Instance {
  compile(schema: unknown): CompiledSchemaValidator;
}

interface Ajv2020Constructor {
  new (opts?: Record<string, unknown>): Ajv2020Instance;
}

type AddFormatsFunction = (ajv: unknown) => void;

const observationEventSchemaPath = new URL(
  '../../schemas/v1/technical-observation-event.json',
  import.meta.url,
);
const cameraRegionConfigurationSchemaPath = new URL(
  '../../schemas/v1/camera-region-configuration.json',
  import.meta.url,
);
const expandedObservationEventSchemaPath = new URL(
  '../../schemas/v1.1/technical-observation-event.json',
  import.meta.url,
);
const v12ObservationEventSchemaPath = new URL(
  '../../schemas/v1.2/technical-observation-event.json',
  import.meta.url,
);
const observationEventSchema: unknown = JSON.parse(
  readFileSync(observationEventSchemaPath, 'utf8'),
);
const cameraRegionConfigurationSchema: unknown = JSON.parse(
  readFileSync(cameraRegionConfigurationSchemaPath, 'utf8'),
);

// Resolve constructor robustly across CJS/ESM interop without any
const resolvedAjvConstructor = (typeof Ajv2020Pkg === 'function'
  ? Ajv2020Pkg
  : (Ajv2020Pkg as unknown as { default: Ajv2020Constructor })
      .default) as unknown as Ajv2020Constructor;

const resolvedAddFormats = (
  typeof addFormatsPkg === 'function'
    ? addFormatsPkg
    : (addFormatsPkg as unknown as { default: AddFormatsFunction }).default
) as AddFormatsFunction;

const ajv = new resolvedAjvConstructor({
  allErrors: true,
  strict: true,
});
resolvedAddFormats(ajv);

const validateObservationEventSchema: CompiledSchemaValidator = ajv.compile(observationEventSchema);
const validateExpandedObservationEventSchema: CompiledSchemaValidator = ajv.compile(
  JSON.parse(readFileSync(expandedObservationEventSchemaPath, 'utf8')) as unknown,
);
const validateV12ObservationEventSchema: CompiledSchemaValidator = ajv.compile(
  JSON.parse(readFileSync(v12ObservationEventSchemaPath, 'utf8')) as unknown,
);
const validateEightFamilySchema: CompiledSchemaValidator = ajv.compile(
  JSON.parse(
    readFileSync(
      new URL('../../schemas/v1.3/technical-observation-event.json', import.meta.url),
      'utf8',
    ),
  ) as unknown,
);
const validatePartitionedFrameSchema: CompiledSchemaValidator = ajv.compile(
  JSON.parse(
    readFileSync(
      new URL('../../schemas/v1.4/technical-observation-event.json', import.meta.url),
      'utf8',
    ),
  ) as unknown,
);
const validateCameraRegionConfigurationSchema: CompiledSchemaValidator = ajv.compile(
  cameraRegionConfigurationSchema,
);

function schemaValidationIssues(
  validateSchema: CompiledSchemaValidator,
  data: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const valid = validateSchema(data);

  if (!valid && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      let issuePath = err.instancePath || '';
      let issueMessage = err.message || 'Schema validation error';

      if (err.keyword === 'required' && typeof err.params.missingProperty === 'string') {
        issuePath = issuePath
          ? `${issuePath}/${err.params.missingProperty}`
          : `/${err.params.missingProperty}`;
        issueMessage = `Missing required property: ${err.params.missingProperty}`;
      } else if (
        err.keyword === 'additionalProperties' &&
        typeof err.params.additionalProperty === 'string'
      ) {
        issuePath = issuePath
          ? `${issuePath}/${err.params.additionalProperty}`
          : `/${err.params.additionalProperty}`;
        issueMessage = `Unexpected additional property: ${err.params.additionalProperty}`;
      }

      issues.push({
        code: 'SCHEMA_VIOLATION',
        path: issuePath || '/',
        message: issueMessage,
      });
    }
  }

  return issues;
}

/**
 * Validates a technical observation envelope against:
 * 1. Canonical Draft 2020-12 schema rules, formats, bounds, and conditional identity semantics.
 * 2. Semantic cross-field bounding-box geometry (x1 < x2, y1 < y2) across observations and evidence.
 */
export function validateObservationEvent(data: unknown): ValidationResult {
  const version =
    typeof data === 'object' && data !== null && 'schemaVersion' in data
      ? data.schemaVersion
      : undefined;
  const validator =
    version === '1.2.0'
      ? validateV12ObservationEventSchema
      : version === '1.1.0'
        ? validateExpandedObservationEventSchema
        : validateObservationEventSchema;
  const issues = schemaValidationIssues(validator, data);

  const geometryIssues = validateGeometries(data);
  issues.push(...geometryIssues);

  return {
    isValid: issues.length === 0,
    issues,
  };
}

/** Explicit eight-family candidate only; existing consumers retain their version admission. */
export function validateEightFamilyObservationEvent(data: unknown): ValidationResult {
  const issues = schemaValidationIssues(validateEightFamilySchema, data);
  issues.push(...validateGeometries(data));
  return { isValid: issues.length === 0, issues };
}

/** Explicit opt-in only; legacy admission never treats part metadata as established frame trust. */
export function validatePartitionedObservationEvent(data: unknown): ValidationResult {
  const issues = schemaValidationIssues(validatePartitionedFrameSchema, data);
  issues.push(...validateGeometries(data));
  if (issues.length) return { isValid: false, issues };
  const payload = data as {
    framePartition: ObservationFramePartition;
    observations: Array<{ type: string; trackId: number }>;
  };
  const frame = payload.framePartition;
  if (frame.partIndex >= frame.partCount) {
    issues.push({
      code: 'SCHEMA_VIOLATION',
      path: '/framePartition/partIndex',
      message: 'partIndex must be less than partCount',
    });
  }
  if (BigInt(frame.sequenceNumber) > 18_446_744_073_709_551_615n) {
    issues.push({
      code: 'SCHEMA_VIOLATION',
      path: '/framePartition/sequenceNumber',
      message: 'sequenceNumber must be an unsigned 64-bit decimal integer',
    });
  }
  const people = new Map<number, number>();
  for (const observation of payload.observations) {
    if (observation.type === 'PERSON') {
      people.set(observation.trackId, (people.get(observation.trackId) ?? 0) + 1);
    }
  }
  payload.observations.forEach((observation, index) => {
    if (people.get(observation.trackId) !== 1) {
      issues.push({
        code: 'SCHEMA_VIOLATION',
        path: `/observations/${index}/trackId`,
        message: 'Each track requires exactly one PERSON in the same part',
      });
    }
  });
  return { isValid: issues.length === 0, issues };
}

export function validateCameraRegionConfiguration(data: unknown): ValidationResult {
  const issues = schemaValidationIssues(validateCameraRegionConfigurationSchema, data);

  return {
    isValid: issues.length === 0,
    issues,
  };
}
