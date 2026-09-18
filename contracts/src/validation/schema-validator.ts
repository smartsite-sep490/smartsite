import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020Pkg from 'ajv/dist/2020.js';
import addFormatsPkg from 'ajv-formats';
import { validateGeometry } from './geometry-validator.js';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveSchemaPath(): string {
  // Traverse upward until schemas/v1/technical-observation-event.json is found
  let cur = __dirname;
  while (cur !== path.dirname(cur)) {
    const candidate = path.join(cur, 'schemas', 'v1', 'technical-observation-event.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    cur = path.dirname(cur);
  }
  throw new Error('Unable to locate canonical schema file: schemas/v1/technical-observation-event.json');
}

const schemaPath = resolveSchemaPath();
const rawSchema: unknown = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// Resolve constructor robustly across CJS/ESM interop without using any
const resolvedAjvConstructor = (
  typeof Ajv2020Pkg === 'function'
    ? Ajv2020Pkg
    : (Ajv2020Pkg as unknown as { default: Ajv2020Constructor }).default
) as unknown as Ajv2020Constructor;

const resolvedAddFormats = (
  typeof addFormatsPkg === 'function'
    ? addFormatsPkg
    : (addFormatsPkg as unknown as { default: AddFormatsFunction }).default
) as AddFormatsFunction;

// Instantiate Ajv Draft 2020-12 with formats support
const ajv = new resolvedAjvConstructor({
  allErrors: true,
  strict: false,
});
resolvedAddFormats(ajv);

const validateSchema: CompiledSchemaValidator = ajv.compile(rawSchema);

/**
 * Validates a technical observation envelope against:
 * 1. Canonical JSON Schema Draft 2020-12 structural rules, formats, bounds, and conditional identity rules.
 * 2. Cross-field semantic geometric invariants (x1 < x2, y1 < y2, polygon vertex counts).
 */
export function validateObservationEvent(data: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];

  const valid = validateSchema(data);
  if (!valid && validateSchema.errors) {
    for (const err of validateSchema.errors) {
      let issuePath = err.instancePath || '';
      let issueMessage = err.message || 'Schema validation error';

      if (err.keyword === 'required' && typeof err.params.missingProperty === 'string') {
        issuePath = issuePath ? `${issuePath}/${err.params.missingProperty}` : `/${err.params.missingProperty}`;
        issueMessage = `Missing required property: ${err.params.missingProperty}`;
      } else if (err.keyword === 'additionalProperties' && typeof err.params.additionalProperty === 'string') {
        issuePath = issuePath ? `${issuePath}/${err.params.additionalProperty}` : `/${err.params.additionalProperty}`;
        issueMessage = `Unexpected additional property: ${err.params.additionalProperty}`;
      }

      issues.push({
        code: 'SCHEMA_VIOLATION',
        path: issuePath || '/',
        message: issueMessage,
      });
    }
  }

  // 2. Semantic geometry validation
  const geometryIssues = validateGeometry(data);
  issues.push(...geometryIssues);

  return {
    isValid: issues.length === 0,
    issues,
  };
}
