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
  const issues = schemaValidationIssues(validateObservationEventSchema, data);

  const geometryIssues = validateGeometries(data);
  issues.push(...geometryIssues);

  return {
    isValid: issues.length === 0,
    issues,
  };
}

export function validateCameraRegionConfiguration(data: unknown): ValidationResult {
  const issues = schemaValidationIssues(validateCameraRegionConfigurationSchema, data);

  return {
    isValid: issues.length === 0,
    issues,
  };
}
