import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  parseRegionGeometryConfirmation as parse,
  type ConfirmedRegionGeometryConfirmation,
  type UnconfirmedRegionGeometryConfirmation,
} from '../src/index.js';

const referenceId = 'a1111111-2222-4333-8444-55555555555a';
const confirmedByUserId = '22222222-3333-4444-8555-666666666662';
const confirmedAt = '2026-10-26T14:30:00.000Z';

const manuallyConfirmed = (): ConfirmedRegionGeometryConfirmation => ({
  status: 'MANUALLY_CONFIRMED',
  referenceId,
  viewRevision: 2,
  confirmedByUserId,
  confirmedAt,
});

const needsRevalidation = (): ConfirmedRegionGeometryConfirmation => ({
  status: 'NEEDS_REVALIDATION',
  referenceId,
  viewRevision: 2,
  confirmedByUserId,
  confirmedAt,
});

const unconfirmed = (): UnconfirmedRegionGeometryConfirmation => ({
  status: 'UNCONFIRMED',
  referenceId: null,
  viewRevision: null,
  confirmedByUserId: null,
  confirmedAt: null,
});

test('published JSON schema and parser agree on valid states and inconsistent provenance', () => {
  const ajv = new Ajv2020.default({ strict: true });
  addFormats.default(ajv);
  const validate = ajv.compile(
    JSON.parse(
      readFileSync(
        new URL('../schemas/v1/camera-region-geometry-confirmation.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  for (const value of [unconfirmed(), manuallyConfirmed(), needsRevalidation()]) {
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    assert.deepEqual(parse(value), value);
  }
  for (const value of [
    { ...unconfirmed(), referenceId },
    { ...manuallyConfirmed(), confirmedAt: null },
    { ...manuallyConfirmed(), status: 'LOADED' },
    { ...manuallyConfirmed(), confirmedAt: '2026-02-29T00:00:00.000Z' },
  ]) {
    assert.equal(validate(value), false);
    assert.throws(() => parse(value));
  }
});

test('accepts all 3 valid geometryConfirmation states, returns a detached clone, and never fabricates missing responses', () => {
  const inputConfirmed = manuallyConfirmed();
  const parsedConfirmed = parse(inputConfirmed);
  assert.deepEqual(parsedConfirmed, inputConfirmed);
  assert.notEqual(parsedConfirmed, inputConfirmed);

  // Historic manual confirmation metadata is preserved when viewRevision is retired (NEEDS_REVALIDATION).
  const inputRevalidation = needsRevalidation();
  const parsedRevalidation = parse(inputRevalidation);
  assert.deepEqual(parsedRevalidation, inputRevalidation);
  assert.notEqual(parsedRevalidation, inputRevalidation);

  const inputUnconfirmed = unconfirmed();
  const parsedUnconfirmed = parse(inputUnconfirmed);
  assert.deepEqual(parsedUnconfirmed, inputUnconfirmed);
  assert.notEqual(parsedUnconfirmed, inputUnconfirmed);

  // Mutating caller object after parsing cannot mutate returned confirmation.
  const mutable = { ...manuallyConfirmed() } as Record<string, unknown>;
  const cloned = parse(mutable);
  mutable.viewRevision = 99;
  assert.equal(cloned.viewRevision, 2);

  // Undefined/missing/non-object responses must fail rather than fabricating UNCONFIRMED.
  for (const missingOrInvalid of [undefined, null, {}, [], 'UNCONFIRMED', 123, true]) {
    assert.throws(() => parse(missingOrInvalid));
  }
});

test('rejects unknown statuses, worker/policy application claims, viewValidity conflation, and extra/symbol/inherited keys', () => {
  for (const invalidStatus of [
    'LOADED',
    'APPLIED',
    'CONFIRMED',
    'EXPIRED',
    'VALID',
    'manually_confirmed',
    '',
    null,
    1,
  ]) {
    assert.throws(() => parse({ ...manuallyConfirmed(), status: invalidStatus }));
    assert.throws(() => parse({ ...unconfirmed(), status: invalidStatus }));
  }

  for (const forbiddenField of [
    { workerStatus: 'LOADED' },
    { appliedAt: confirmedAt },
    { policyBundleVersion: 4 },
    { viewValidity: 'UNCONFIRMED' },
    { isCutoverBaseline: false },
    { expiresAt: '2026-10-26T14:35:00.000Z' },
    { actorUserId: confirmedByUserId },
    { siteId: referenceId },
    { cameraId: referenceId },
  ]) {
    assert.throws(() => parse({ ...manuallyConfirmed(), ...forbiddenField }));
    assert.throws(() => parse({ ...unconfirmed(), ...forbiddenField }));
  }

  assert.throws(() => parse({ ...manuallyConfirmed(), [Symbol('spoof')]: true }));
  assert.throws(() =>
    parse(Object.assign(Object.create({ inherited: true }), manuallyConfirmed())),
  );
});

test('rejects partial or null-inconsistent provenance across UNCONFIRMED, MANUALLY_CONFIRMED, and NEEDS_REVALIDATION', () => {
  const provenanceKeys = [
    'referenceId',
    'viewRevision',
    'confirmedByUserId',
    'confirmedAt',
  ] as const;

  for (const key of ['status', ...provenanceKeys]) {
    const missingFromConfirmed: Record<string, unknown> = { ...manuallyConfirmed() };
    delete missingFromConfirmed[key];
    assert.throws(() => parse(missingFromConfirmed));

    const missingFromUnconfirmed: Record<string, unknown> = { ...unconfirmed() };
    delete missingFromUnconfirmed[key];
    assert.throws(() => parse(missingFromUnconfirmed));
  }

  // UNCONFIRMED requires all 4 provenance fields to be strictly null.
  for (const nonNullOverride of [
    { referenceId },
    { viewRevision: 1 },
    { confirmedByUserId },
    { confirmedAt },
    { referenceId: undefined },
    { viewRevision: 0 },
    { confirmedByUserId: '' },
    { confirmedAt: '' },
  ]) {
    assert.throws(() => parse({ ...unconfirmed(), ...nonNullOverride }));
  }

  // MANUALLY_CONFIRMED and NEEDS_REVALIDATION require all 4 provenance fields to be non-null.
  for (const base of [manuallyConfirmed(), needsRevalidation()]) {
    for (const key of provenanceKeys) {
      assert.throws(() => parse({ ...base, [key]: null }));
      assert.throws(() => parse({ ...base, [key]: undefined }));
    }
    assert.throws(() => parse({ ...unconfirmed(), status: base.status }));
  }
});

test('requires lowercase canonical UUIDs and positive safe integer viewRevision on confirmed states', () => {
  for (const badUuid of [
    '',
    'ref-1',
    referenceId.toUpperCase(),
    '11111111-2222-4333-8444-55555555555A',
    ` ${referenceId}`,
    `${referenceId} `,
    referenceId.slice(0, -1),
    `${referenceId}0`,
    '11111111-2222-4333-8444-55555555555g',
  ]) {
    assert.throws(() => parse({ ...manuallyConfirmed(), referenceId: badUuid }));
    assert.throws(() => parse({ ...needsRevalidation(), confirmedByUserId: badUuid }));
  }

  for (const badRevision of [
    0,
    -1,
    1.5,
    '2',
    true,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(() => parse({ ...manuallyConfirmed(), viewRevision: badRevision }));
    assert.throws(() => parse({ ...needsRevalidation(), viewRevision: badRevision }));
  }

  assert.equal(
    parse({ ...manuallyConfirmed(), viewRevision: Number.MAX_SAFE_INTEGER }).viewRevision,
    Number.MAX_SAFE_INTEGER,
  );
});

test('requires canonical UTC ISO-8601 confirmedAt and rejects non-UTC offsets or impossible calendar dates', () => {
  for (const validTimestamp of [
    '2026-10-26T00:00:00.000Z',
    '2026-10-26T14:30:00.100Z',
    '2026-10-26T14:30:00.123Z',
    '2024-02-29T23:59:59.999Z',
  ]) {
    assert.equal(
      parse({ ...manuallyConfirmed(), confirmedAt: validTimestamp }).confirmedAt,
      validTimestamp,
    );
  }

  for (const invalidTimestamp of [
    '',
    '2026-10-26T14:30:00Z',
    '2026-10-26T14:30:00.1Z',
    '2026-10-26T14:30:00.123456Z',
    '2026-10-26',
    '2026-10-26 14:30:00Z',
    '2026-10-26T14:30:00',
    '2026-10-26T14:30:00.000+00:00',
    '2026-10-26T14:30:00.000+07:00',
    '2026-10-26T14:30:00.000-05:00',
    '2026-10-26T14:30:00.1234567Z',
    '2026-02-29T12:00:00.000Z',
    '2026-04-31T12:00:00.000Z',
    '2026-13-01T12:00:00.000Z',
    '2026-00-10T12:00:00.000Z',
    '2026-10-00T12:00:00.000Z',
    '2026-10-26T24:00:00.000Z',
    '2026-10-26T14:60:00.000Z',
    '2026-10-26T14:30:60.000Z',
  ]) {
    assert.throws(
      () => parse({ ...manuallyConfirmed(), confirmedAt: invalidTimestamp }),
      invalidTimestamp,
    );
  }
});
