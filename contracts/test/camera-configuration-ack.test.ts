import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  MAX_CAMERA_CONFIGURATION_ACK_BYTES,
  parseCameraConfigurationAcknowledgementPayload as parse,
  type CameraConfigurationAcknowledgement,
} from '../src/camera-configuration-ack.js';

function baseBinding() {
  return {
    commandId: '11111111-2222-4333-8444-555555555551',
    workerGenerationId: '22222222-3333-4444-8555-666666666662',
    streamSessionId: '33333333-4444-4555-8666-777777777773',
    configurationVersion: 3,
    bundleSha256: 'a'.repeat(64),
    viewRevision: 2,
  };
}

function loadedAck(): CameraConfigurationAcknowledgement {
  return {
    ...baseBinding(),
    outcome: 'LOADED',
  };
}

test('ACK JSON schema rejects sender time, unknown fields and LOADED diagnostic claims', () => {
  const ajv = new Ajv2020.default({ strict: true });
  addFormats.default(ajv);
  const validate = ajv.compile(
    JSON.parse(
      readFileSync(new URL('../schemas/v1/camera-configuration-ack.json', import.meta.url), 'utf8'),
    ),
  );
  const valid = loadedAck();
  assert.equal(validate(valid), true);
  for (const invalid of [
    { ...valid, appliedAt: '2026-10-30T00:00:00.000Z' },
    { ...valid, reasonCode: 'UNSUPPORTED' },
    { ...valid, configurationVersion: '1' },
  ])
    assert.equal(validate(invalid), false);
});

function rejectedAck(reasonCode?: string): CameraConfigurationAcknowledgement {
  return reasonCode === undefined
    ? { ...baseBinding(), outcome: 'REJECTED' }
    : { ...baseBinding(), outcome: 'REJECTED', reasonCode };
}

function assertRejected(payload: unknown, expectedCode = 'SCHEMA_VIOLATION') {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = parse(raw);
  assert.equal(result.isValid, false);
  assert.equal(result.value, undefined);
  assert.equal(result.issues[0]?.code, expectedCode);
}

test('accepts valid LOADED and REJECTED acknowledgements from UTF-8 strings and bytes', () => {
  assert.equal(MAX_CAMERA_CONFIGURATION_ACK_BYTES, 4096);

  const loaded = loadedAck();
  const loadedJson = JSON.stringify(loaded);
  const parsedLoaded = parse(loadedJson);
  assert.equal(parsedLoaded.isValid, true);
  assert.deepEqual(parsedLoaded.issues, []);
  assert.deepEqual(parsedLoaded.value, loaded);

  const parsedLoadedBytes = parse(new TextEncoder().encode(loadedJson));
  assert.equal(parsedLoadedBytes.isValid, true);
  assert.deepEqual(parsedLoadedBytes.value, loaded);

  const rejectedNoReason = rejectedAck();
  const parsedRejectedNoReason = parse(JSON.stringify(rejectedNoReason));
  assert.equal(parsedRejectedNoReason.isValid, true);
  assert.deepEqual(parsedRejectedNoReason.value, rejectedNoReason);

  for (const reasonCode of ['A', 'CHECKSUM_MISMATCH', 'R' + '_A9'.repeat(21)]) {
    assert.ok(reasonCode.length >= 1 && reasonCode.length <= 64);
    const rejectedWithReason = rejectedAck(reasonCode);
    const raw = JSON.stringify(rejectedWithReason);
    assert.deepEqual(parse(raw).value, rejectedWithReason);
    assert.deepEqual(parse(new TextEncoder().encode(raw)).value, rejectedWithReason);
  }

  const exactLimitJson =
    loadedJson +
    ' '.repeat(MAX_CAMERA_CONFIGURATION_ACK_BYTES - Buffer.byteLength(loadedJson, 'utf8'));
  assert.equal(Buffer.byteLength(exactLimitJson, 'utf8'), MAX_CAMERA_CONFIGURATION_ACK_BYTES);
  assert.equal(parse(exactLimitJson).isValid, true);
});

test('requires canonical lowercase UUIDs for commandId, workerGenerationId and streamSessionId', () => {
  const fields = ['commandId', 'workerGenerationId', 'streamSessionId'] as const;
  const invalidIds = [
    '11111111-2222-4333-8444-55555555555A',
    '11111111222243338444555555555551',
    '11111111-2222-4333-8444-55555555555',
    '11111111-2222-4333-8444-55555555555g',
    '',
    123,
    null,
  ];
  for (const field of fields) {
    for (const invalidId of invalidIds) {
      assertRejected({ ...loadedAck(), [field]: invalidId });
    }
  }
});

test('requires positive safe integers for configurationVersion and viewRevision', () => {
  const maxSafe = parse(
    JSON.stringify({
      ...loadedAck(),
      configurationVersion: Number.MAX_SAFE_INTEGER,
      viewRevision: Number.MAX_SAFE_INTEGER,
    }),
  );
  assert.equal(maxSafe.isValid, true);

  for (const field of ['configurationVersion', 'viewRevision'] as const) {
    for (const badVersion of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      assertRejected({ ...loadedAck(), [field]: badVersion });
    }
  }
});

test('requires canonical lowercase 64-character hex bundleSha256', () => {
  for (const bundleSha256 of [
    'A'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
    'g'.repeat(64),
    ` ${'a'.repeat(63)}`,
    '',
    123,
    null,
  ]) {
    assertRejected({ ...loadedAck(), bundleSha256 });
  }
});

test('rejects unknown fields, sender timestamps and unsupported outcomes', () => {
  for (const forbiddenField of [
    'receivedAt',
    'appliedAt',
    'issuedAt',
    'acknowledgedAt',
    'timestamp',
    'cameraId',
    'schemaVersion',
    'reason',
    'extra',
  ]) {
    assertRejected({ ...loadedAck(), [forbiddenField]: '2026-10-25T12:00:00.000Z' });
    assertRejected({
      ...rejectedAck('INVALID_GEOMETRY'),
      [forbiddenField]: '2026-10-25T12:00:00.000Z',
    });
  }

  for (const outcome of ['APPLIED', 'PENDING', 'FAILED', 'loaded', 'rejected', '', null]) {
    assertRejected({ ...loadedAck(), outcome });
  }

  for (const requiredKey of Object.keys(loadedAck())) {
    const copy = { ...loadedAck() } as Record<string, unknown>;
    delete copy[requiredKey];
    assertRejected(copy);
  }
});

test('permits reasonCode only on REJECTED as a bounded 1..64 uppercase ASCII identifier', () => {
  assertRejected({ ...loadedAck(), reasonCode: 'CHECKSUM_MISMATCH' });
  assertRejected({ ...loadedAck(), reasonCode: '' });
  assertRejected({ ...loadedAck(), reasonCode: null });

  for (const badReasonCode of [
    '',
    '1LEADING_DIGIT',
    '_LEADING_UNDERSCORE',
    'lowercase_reason',
    'Mixed_Case',
    'HYPHEN-NOT-ALLOWED',
    'SPACE NOT ALLOWED',
    'TRAILING_SPACE ',
    'NON_ASCII_Ä',
    'A'.repeat(65),
    null,
    42,
  ]) {
    assertRejected({ ...baseBinding(), outcome: 'REJECTED', reasonCode: badReasonCode });
  }
});

test('returns INVALID_JSON or PAYLOAD_TOO_LARGE without throwing on malformed UTF-8, invalid JSON or oversize payloads', () => {
  for (const badUtf8 of [new Uint8Array([0xff]), new Uint8Array([0xc3, 0x28])]) {
    const result = parse(badUtf8);
    assert.equal(result.isValid, false);
    assert.equal(result.value, undefined);
    assert.equal(result.issues[0]?.code, 'INVALID_JSON');
  }

  for (const badJson of ['{', '', '{"outcome":']) {
    assertRejected(badJson, 'INVALID_JSON');
  }

  for (const nonObjectJson of ['null', '[]', '123', '"string"']) {
    assertRejected(nonObjectJson, 'SCHEMA_VIOLATION');
  }

  const oversizeString = ' '.repeat(MAX_CAMERA_CONFIGURATION_ACK_BYTES + 1);
  assertRejected(oversizeString, 'PAYLOAD_TOO_LARGE');

  const oversizeBytes = new Uint8Array(MAX_CAMERA_CONFIGURATION_ACK_BYTES + 1).fill(0x20);
  const oversizeBytesResult = parse(oversizeBytes);
  assert.equal(oversizeBytesResult.isValid, false);
  assert.equal(oversizeBytesResult.value, undefined);
  assert.equal(oversizeBytesResult.issues[0]?.code, 'PAYLOAD_TOO_LARGE');
});
