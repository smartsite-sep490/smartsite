import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020Pkg from 'ajv/dist/2020.js';
import addFormatsPkg from 'ajv-formats';
import {
  parseCameraConfigurationAcknowledgementPayload,
  type CameraConfigurationAcknowledgement,
} from '../src/camera-configuration-ack.js';
import { parseCameraConfigurationBundlePayload } from '../src/camera-configuration-bundle.js';
import { computeCanonicalPayloadHash } from '../src/hashing/canonical-hash.js';
import { PPE_ITEMS } from '../src/ppe-items.js';
import { parseCameraConfigurationImageReference } from '../src/camera-configuration-image.js';

interface CompiledValidator {
  (data: unknown): boolean;
  errors?: unknown[] | null;
}
interface Ajv2020Instance {
  addSchema(schema: unknown): Ajv2020Instance;
  compile(schema: unknown): CompiledValidator;
}
type Ajv2020Constructor = new (opts?: Record<string, unknown>) => Ajv2020Instance;
type AddFormatsFn = (ajv: unknown) => void;

const Ajv2020 = (
  typeof Ajv2020Pkg === 'function'
    ? Ajv2020Pkg
    : (Ajv2020Pkg as unknown as { default: Ajv2020Constructor }).default
) as Ajv2020Constructor;
const addFormats = (
  typeof addFormatsPkg === 'function'
    ? addFormatsPkg
    : (addFormatsPkg as unknown as { default: AddFormatsFn }).default
) as AddFormatsFn;

function loadSchema(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
}

function compileSchemas() {
  const legacyRegionSchema = loadSchema('../schemas/v1/camera-region-configuration.json');
  const bundleSchema = loadSchema('../schemas/v1/camera-configuration-bundle.json');
  const ackSchema = loadSchema('../schemas/v1/camera-configuration-ack.json');
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(legacyRegionSchema);
  return {
    bundleSchema,
    ackSchema,
    validateBundle: ajv.compile(bundleSchema),
    validateAck: ajv.compile(ackSchema),
  };
}

function imageReference() {
  return {
    schemaVersion: '1.0.0',
    purpose: 'REGION_CONFIGURATION',
    sourceKind: 'LIVE',
    referenceId: '11111111-2222-4333-8444-555555555555',
    siteId: '22222222-3333-4444-8555-666666666666',
    cameraId: '33333333-4444-4555-8666-777777777777',
    sessionId: '44444444-5555-4666-8777-888888888888',
    imageSha256: 'a'.repeat(64),
    width: 1280,
    height: 720,
    capturedAt: '2026-10-26T05:00:00Z',
    issuedAt: '2026-10-26T05:00:01Z',
    expiresAt: '2026-10-26T05:05:00Z',
    configurationVersion: 3,
    viewRevision: 2,
  };
}

function compileReferenceSchema() {
  const schema = loadSchema('../schemas/v1/camera-configuration-image-reference.json');
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  assert.equal(
    schema.$id,
    'https://smartsite.local/contracts/v1/camera-configuration-image-reference.json',
  );
  return ajv.compile(schema);
}

test('image-reference schema compiles strictly and accepts LIVE, REPLAY and preserved offset vectors', () => {
  const validate = compileReferenceSchema();
  for (const value of [
    imageReference(),
    { ...imageReference(), sourceKind: 'REPLAY' },
    { ...imageReference(), capturedAt: '2026-10-26T12:00:00+07:00' },
  ]) {
    assert.equal(validate(value), true);
    assert.deepEqual(parseCameraConfigurationImageReference(value), value);
  }
});

test('image-reference schema and parser reject malformed exact fields and boundaries', () => {
  const validate = compileReferenceSchema();
  const malformed: Record<string, unknown>[] = [
    { ...imageReference(), imageDataUrl: 'not-metadata' },
    { ...imageReference(), sourceKind: 'UNKNOWN' },
    { ...imageReference(), referenceId: 'not-uuid' },
    { ...imageReference(), sessionId: '' },
    { ...imageReference(), configurationVersion: 0 },
    { ...imageReference(), viewRevision: 1.5 },
    { ...imageReference(), configurationVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...imageReference(), width: 63 },
    { ...imageReference(), height: 1281 },
    { ...imageReference(), imageSha256: 'A'.repeat(64) },
    { ...imageReference(), capturedAt: '2026-02-29T05:00:00Z' },
    { ...imageReference(), issuedAt: '2026-10-26T05:00:60Z' },
  ];
  for (const key of Object.keys(imageReference())) {
    const value = { ...imageReference() } as Record<string, unknown>;
    delete value[key];
    malformed.push(value);
  }
  for (const value of malformed) {
    assert.equal(validate(value), false);
    assert.throws(() => parseCameraConfigurationImageReference(value));
  }
});

test('image-reference structural schema cannot establish time relations or server issuance', () => {
  const validate = compileReferenceSchema();
  for (const value of [
    { ...imageReference(), expiresAt: '2026-10-26T05:05:01Z' },
    { ...imageReference(), issuedAt: '2026-10-26T06:00:00Z' },
    { ...imageReference(), expiresAt: '2026-10-26T04:00:00Z' },
  ]) {
    assert.equal(validate(value), true);
    assert.throws(() => parseCameraConfigurationImageReference(value));
  }
  // Matching syntax and time still cannot prove that this UUID was issued by the server.
  assert.equal(validate(imageReference()), true);
});

function baseBundleContent() {
  return {
    schemaVersion: '1.0.0' as const,
    cameraId: '11111111-2222-4333-8444-555555555555',
    cameraExternalId: 'camera-01',
    configurationVersion: 3,
    viewRevision: 2,
    issuedAt: '2026-10-25T12:00:00.000Z',
    regions: [
      {
        regionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1',
        geometryVersion: 1,
        coordinateSpace: 'NORMALIZED_0_1' as const,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.5, 0.1],
            [0.5, 0.5],
            [0.1, 0.5],
          ],
        },
        zoneId: '99999999-8888-4777-8666-555555555551',
        policyRevision: 1,
        requiredPpe: [...PPE_ITEMS],
      },
    ],
  };
}

function hashedBundle(content: Record<string, unknown> = baseBundleContent()) {
  return { ...content, bundleSha256: computeCanonicalPayloadHash(content) };
}

function validLoadedAck(): CameraConfigurationAcknowledgement {
  return {
    commandId: '11111111-2222-4333-8444-555555555551',
    workerGenerationId: '22222222-3333-4444-8555-666666666662',
    streamSessionId: '33333333-4444-4555-8666-777777777773',
    configurationVersion: 3,
    bundleSha256: 'a'.repeat(64),
    viewRevision: 2,
    outcome: 'LOADED',
  };
}

test('canonical bundle and acknowledgement JSON schemas declare draft 2020-12 IDs and compile under strict AJV with local refs', () => {
  const { bundleSchema, ackSchema, validateBundle, validateAck } = compileSchemas();
  assert.equal(bundleSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(
    bundleSchema.$id,
    'https://smartsite.local/contracts/v1/camera-configuration-bundle.json',
  );
  assert.equal(ackSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(ackSchema.$id, 'https://smartsite.local/contracts/v1/camera-configuration-ack.json');
  assert.equal(typeof validateBundle, 'function');
  assert.equal(typeof validateAck, 'function');
});

test('valid bundle and acknowledgement vectors pass both structural JSON schema and runtime parsers', () => {
  const { validateBundle, validateAck } = compileSchemas();
  const emptyPpe = baseBundleContent();
  emptyPpe.regions[0].requiredPpe = [];
  for (const bundle of [
    hashedBundle(),
    hashedBundle(emptyPpe),
    hashedBundle({ ...baseBundleContent(), regions: [] }),
  ]) {
    assert.equal(validateBundle(bundle), true);
    assert.equal(parseCameraConfigurationBundlePayload(JSON.stringify(bundle)).isValid, true);
  }
  for (const ack of [
    validLoadedAck(),
    { ...validLoadedAck(), outcome: 'REJECTED' as const },
    { ...validLoadedAck(), outcome: 'REJECTED' as const, reasonCode: 'A' },
    { ...validLoadedAck(), outcome: 'REJECTED' as const, reasonCode: 'CHECKSUM_MISMATCH' },
    { ...validLoadedAck(), outcome: 'REJECTED' as const, reasonCode: 'R' + '_A9'.repeat(21) },
  ]) {
    assert.equal(validateAck(ack), true);
    assert.equal(parseCameraConfigurationAcknowledgementPayload(JSON.stringify(ack)).isValid, true);
  }
});

test('bundle schema and runtime parser both reject structural violations on envelope, UUIDs, versions, hashes, timestamps and region count', () => {
  const { validateBundle } = compileSchemas();
  const baseRegion = baseBundleContent().regions[0];
  const tooManyRegions = Array.from({ length: 65 }, (_, i) => ({
    ...baseRegion,
    regionId: `aaaaaaaa-bbbb-4ccc-8ddd-${String(i + 1).padStart(12, '0')}`,
  }));
  for (const candidate of [
    { ...hashedBundle(), extra: true },
    hashedBundle({ ...baseBundleContent(), schemaVersion: '1.1.0' }),
    hashedBundle({ ...baseBundleContent(), cameraId: '11111111-2222-4333-8444-55555555555A' }),
    hashedBundle({ ...baseBundleContent(), cameraExternalId: '' }),
    hashedBundle({ ...baseBundleContent(), configurationVersion: 0 }),
    { ...hashedBundle(), configurationVersion: Number.MAX_SAFE_INTEGER + 1 },
    hashedBundle({ ...baseBundleContent(), viewRevision: -1 }),
    hashedBundle({ ...baseBundleContent(), viewRevision: 1.5 }),
    hashedBundle({ ...baseBundleContent(), issuedAt: '2026-10-25T12:00:00Z' }),
    hashedBundle({ ...baseBundleContent(), issuedAt: '2026-10-25T12:00:00.000+00:00' }),
    hashedBundle({ ...baseBundleContent(), issuedAt: '2026-02-30T12:00:00.000Z' }),
    hashedBundle({ ...baseBundleContent(), issuedAt: '2026-10-25T12:00:60.000Z' }),
    { ...hashedBundle(), bundleSha256: 'A'.repeat(64) },
    { ...hashedBundle(), bundleSha256: 'a'.repeat(63) },
    hashedBundle({ ...baseBundleContent(), regions: tooManyRegions }),
  ]) {
    assert.equal(validateBundle(candidate), false);
    assert.equal(parseCameraConfigurationBundlePayload(JSON.stringify(candidate)).isValid, false);
  }
  for (const key of Object.keys(hashedBundle())) {
    const missing: Record<string, unknown> = { ...hashedBundle() };
    delete missing[key];
    assert.equal(validateBundle(missing), false);
    assert.equal(parseCameraConfigurationBundlePayload(JSON.stringify(missing)).isValid, false);
  }
});

test('bundle schema and runtime parser both reject region unknown fields, noncanonical UUIDs, invalid policyRevision, PPE and polygon bounds', () => {
  const { validateBundle } = compileSchemas();
  const base = baseBundleContent();
  const region = base.regions[0];
  for (const badRegion of [
    { ...region, extra: true },
    { ...region, regionId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEE1' },
    { ...region, zoneId: '99999999-8888-4777-8666-55555555555A' },
    { ...region, geometryVersion: 0 },
    { ...region, policyRevision: 0 },
    { ...region, policyRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...region, requiredPpe: ['MASK'] },
    { ...region, requiredPpe: ['HARD_HAT', 'HARD_HAT'] },
    { ...region, polygon: { ...region.polygon, extra: true } },
    {
      ...region,
      polygon: {
        coordinates: [
          [-0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ],
      },
    },
    {
      ...region,
      polygon: {
        coordinates: [
          [0.1, 0.1],
          [0.5, 0.1],
        ],
      },
    },
  ]) {
    const candidate = { ...hashedBundle(base), regions: [badRegion] };
    assert.equal(validateBundle(candidate), false);
    assert.equal(parseCameraConfigurationBundlePayload(JSON.stringify(candidate)).isValid, false);
  }
});

test('acknowledgement schema and runtime parser both reject unknown fields, sender timestamps, invalid UUIDs/versions/hashes, outcomes and reasonCode', () => {
  const { validateAck } = compileSchemas();
  const base = validLoadedAck();
  for (const candidate of [
    { ...base, receivedAt: '2026-10-25T12:00:00.000Z' },
    { ...base, appliedAt: '2026-10-25T12:00:00.000Z' },
    { ...base, schemaVersion: '1.0.0' },
    { ...base, cameraId: '11111111-2222-4333-8444-555555555555' },
    { ...base, commandId: '11111111-2222-4333-8444-55555555555A' },
    { ...base, workerGenerationId: '22222222-3333-4444-8555-66666666666A' },
    { ...base, streamSessionId: '33333333-4444-4555-8666-77777777777A' },
    { ...base, configurationVersion: 0 },
    { ...base, viewRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, bundleSha256: 'A'.repeat(64) },
    { ...base, outcome: 'APPLIED' },
    { ...base, outcome: 'LOADED', reasonCode: 'CHECKSUM_MISMATCH' },
    { ...base, outcome: 'REJECTED', reasonCode: '' },
    { ...base, outcome: 'REJECTED', reasonCode: '1LEADING_DIGIT' },
    { ...base, outcome: 'REJECTED', reasonCode: '_LEADING_UNDERSCORE' },
    { ...base, outcome: 'REJECTED', reasonCode: 'lowercase_reason' },
    { ...base, outcome: 'REJECTED', reasonCode: 'BAD-CODE' },
    { ...base, outcome: 'REJECTED', reasonCode: 'A'.repeat(65) },
  ]) {
    assert.equal(validateAck(candidate), false);
    assert.equal(
      parseCameraConfigurationAcknowledgementPayload(JSON.stringify(candidate)).isValid,
      false,
    );
  }
  for (const key of Object.keys(base)) {
    const missing: Record<string, unknown> = { ...base };
    delete missing[key];
    assert.equal(validateAck(missing), false);
    assert.equal(
      parseCameraConfigurationAcknowledgementPayload(JSON.stringify(missing)).isValid,
      false,
    );
  }
});

test('semantic gap: tampered bundleSha256, duplicate regionId with distinct body and self-intersecting/collinear polygons pass structural schema but fail runtime parser', () => {
  const { validateBundle } = compileSchemas();
  const base = baseBundleContent();
  const region = base.regions[0];
  const tamperedHash = { ...hashedBundle(base), bundleSha256: '0'.repeat(64) };
  const duplicateRegionIdDistinctBody = hashedBundle({
    ...base,
    regions: [region, { ...region, policyRevision: 2 }],
  });
  const selfIntersecting = hashedBundle({
    ...base,
    regions: [
      {
        ...region,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.5, 0.5],
            [0.5, 0.1],
            [0.1, 0.5],
          ],
        },
      },
    ],
  });
  const collinearZeroArea = hashedBundle({
    ...base,
    regions: [
      {
        ...region,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.2, 0.2],
            [0.3, 0.3],
          ],
        },
      },
    ],
  });
  for (const semanticInvalid of [
    tamperedHash,
    duplicateRegionIdDistinctBody,
    selfIntersecting,
    collinearZeroArea,
  ]) {
    assert.equal(validateBundle(semanticInvalid), true);
    const runtimeResult = parseCameraConfigurationBundlePayload(JSON.stringify(semanticInvalid));
    assert.equal(runtimeResult.isValid, false);
    assert.equal(runtimeResult.value, undefined);
  }
});
