import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_CAMERA_REGION_PAYLOAD_BYTES,
  parseCameraRegionConfigurationPayload,
} from '@smartsite/contracts';
import type { CameraRegionConfigurationValidationResult } from '@smartsite/contracts';

const configuration = {
  schemaVersion: '1.0.0',
  configurationVersion: 42,
  cameraExternalId: 'CAM-CỔNG-01',
  regions: [],
};

function assertRejected(
  result: CameraRegionConfigurationValidationResult,
  code: string,
  path = '/',
) {
  assert.equal(result.isValid, false);
  assert.equal(result.issues[0]?.code, code);
  assert.equal(result.issues[0]?.path, path);
  assert.equal(Object.hasOwn(result, 'value'), false);
}

test('rejects oversized bytes before JSON parsing or UTF-8 decoding', () => {
  assertRejected(
    parseCameraRegionConfigurationPayload(new TextEncoder().encode(' '.repeat(262145))),
    'PAYLOAD_TOO_LARGE',
  );
  const invalidUtf8 = new Uint8Array(262145).fill(0xff);
  assertRejected(parseCameraRegionConfigurationPayload(invalidUtf8), 'PAYLOAD_TOO_LARGE');
});

test('measures string payloads in UTF-8 bytes before schema validation', () => {
  const payload = JSON.stringify({ ...configuration, unexpected: 'Việt Nam'.repeat(28000) });
  assert.ok(payload.length < MAX_CAMERA_REGION_PAYLOAD_BYTES);
  assert.ok(Buffer.byteLength(payload, 'utf8') > MAX_CAMERA_REGION_PAYLOAD_BYTES);
  assertRejected(parseCameraRegionConfigurationPayload(payload), 'PAYLOAD_TOO_LARGE');
});

test('accepts payloads exactly at the byte limit for strings and bytes', () => {
  const json = JSON.stringify(configuration);
  const payload = json + ' '.repeat(262144 - Buffer.byteLength(json, 'utf8'));
  for (const input of [payload, new TextEncoder().encode(payload)]) {
    const result = parseCameraRegionConfigurationPayload(input);
    assert.deepEqual(result, { isValid: true, issues: [], value: configuration });
  }
});

test('rejects a string one byte above the limit before JSON parsing', () => {
  assertRejected(parseCameraRegionConfigurationPayload(' '.repeat(262145)), 'PAYLOAD_TOO_LARGE');
});

test('rejects malformed JSON below the byte limit', () => {
  for (const payload of ['', '{', '{} {}']) {
    assertRejected(parseCameraRegionConfigurationPayload(payload), 'INVALID_JSON');
  }
});

test('rejects invalid UTF-8 even inside a JSON string', () => {
  const prefix = Buffer.from('{"cameraExternalId":"');
  const suffix = Buffer.from('"}');
  for (const invalid of [[0xff], [0xc3, 0x28], [0xe2, 0x82], [0xc0, 0xaf]]) {
    assertRejected(
      parseCameraRegionConfigurationPayload(Buffer.concat([prefix, Buffer.from(invalid), suffix])),
      'INVALID_JSON',
    );
  }
});

test('accepts valid UTF-8 and decodes only the supplied byte view', () => {
  const bytes = Buffer.from(JSON.stringify(configuration));
  const backing = Buffer.concat([Buffer.from([0xff]), bytes, Buffer.from([0xff])]);
  const result = parseCameraRegionConfigurationPayload(backing.subarray(1, backing.length - 1));
  assert.deepEqual(result, { isValid: true, issues: [], value: configuration });
});

test('rejects an illegal property containing Vietnamese text below the limit', () => {
  assertRejected(
    parseCameraRegionConfigurationPayload(
      JSON.stringify({ ...configuration, unexpected: 'Việt Nam' }),
    ),
    'SCHEMA_VIOLATION',
    '/unexpected',
  );
});

test('returns schema issues without traversing malformed polygon structure', () => {
  for (const payload of [
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...configuration, regions: [null] }),
  ]) {
    const result = parseCameraRegionConfigurationPayload(payload);
    assert.equal(result.isValid, false);
    assert.ok(result.issues.every((issue) => issue.code === 'SCHEMA_VIOLATION'));
    assert.equal(Object.hasOwn(result, 'value'), false);
  }
});
