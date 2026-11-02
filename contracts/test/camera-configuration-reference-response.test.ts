import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as imageContracts from '../src/camera-configuration-image.js';
import * as publicContracts from '../src/index.js';

// Marker-only synthetic JPEG (120x80). Browser decode remains a separate required check.
const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]);

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const referenceId = '44444444-4444-4444-8444-444444444444';
const otherUuid = '99999999-9999-4999-8999-999999999999';

const validImage = () => ({
  schemaVersion: 1 as const,
  purpose: 'REGION_CONFIGURATION' as const,
  sourceKind: 'LIVE' as 'LIVE' | 'REPLAY',
  siteId,
  cameraId,
  configurationVersion: 4,
  referenceExpiresAt: '2026-10-26T05:05:00.000Z',
  frame: {
    cameraExternalId: 'gate-01',
    sessionId,
    sequenceNumber: '9223372036854775807',
    capturedAt: '2026-10-26T05:00:00.000Z',
    width: 120,
    height: 80,
    imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    imageSha256: 'a'.repeat(64),
  },
});

const validReference = () => ({
  schemaVersion: '1.0.0' as const,
  purpose: 'REGION_CONFIGURATION' as const,
  sourceKind: 'LIVE' as 'LIVE' | 'REPLAY',
  referenceId,
  siteId,
  cameraId,
  sessionId,
  imageSha256: 'a'.repeat(64),
  width: 120,
  height: 80,
  capturedAt: '2026-10-26T05:00:00.000Z',
  issuedAt: '2026-10-26T05:00:01.000Z',
  expiresAt: '2026-10-26T05:05:00.000Z',
  configurationVersion: 4,
  viewRevision: 2,
});

const validEnvelope = () => ({
  image: validImage(),
  reference: validReference(),
  viewValidity: 'UNCONFIRMED' as const,
});

function requireParser(): (input: unknown) => ReturnType<typeof validEnvelope> {
  const fn = (imageContracts as unknown as Record<string, unknown>)
    .parseCameraConfigurationReferenceResponse;
  assert.equal(
    typeof fn,
    'function',
    'Missing canonical parseCameraConfigurationReferenceResponse',
  );
  assert.equal(
    (publicContracts as unknown as Record<string, unknown>)
      .parseCameraConfigurationReferenceResponse,
    fn,
  );
  return fn as (input: unknown) => ReturnType<typeof validEnvelope>;
}

describe('camera configuration reference response contract', () => {
  it('accepts coherent LIVE/REPLAY responses, case-insensitive UUIDs, equivalent timestamp instants, and detaches clones', () => {
    const parse = requireParser();
    const original = validEnvelope();
    const parsed = parse(original);
    assert.deepEqual(parsed, original);
    parsed.image.frame.width = 999;
    parsed.reference.width = 999;
    assert.equal(original.image.frame.width, 120);
    assert.equal(original.reference.width, 120);

    const replayAndOffset = {
      image: {
        ...validImage(),
        sourceKind: 'REPLAY' as const,
        siteId: siteId.toUpperCase(),
        cameraId: cameraId.toUpperCase(),
        referenceExpiresAt: '2026-10-26T05:05:00.000Z',
        frame: {
          ...validImage().frame,
          sessionId: sessionId.toUpperCase(),
          capturedAt: '2026-10-26T05:00:00.000Z',
        },
      },
      reference: {
        ...validReference(),
        sourceKind: 'REPLAY' as const,
        siteId: siteId.toLowerCase(),
        cameraId: cameraId.toLowerCase(),
        sessionId: sessionId.toLowerCase(),
        capturedAt: '2026-10-26T12:00:00+07:00',
        issuedAt: '2026-10-26T12:00:01+07:00',
        expiresAt: '2026-10-26T12:05:00+07:00',
      },
      viewValidity: 'UNCONFIRMED' as const,
    };
    assert.deepEqual(parse(replayAndOffset), replayAndOffset);
  });

  it('rejects unknown outer keys, invalid viewValidity, and any image-reference coherence mismatch', () => {
    const parse = requireParser();
    const invalidCases: Array<[string, unknown]> = [
      ['null-envelope', null],
      ['prototype-envelope', Object.assign(Object.create({ inherited: true }), validEnvelope())],
      ['symbol-key', { ...validEnvelope(), [Symbol('extra')]: true }],
      ['missing-viewValidity', { image: validImage(), reference: validReference() }],
      ['unknown-outer-key', { ...validEnvelope(), extra: 'untrusted' }],
      ['invalid-viewValidity-confirmed', { ...validEnvelope(), viewValidity: 'CONFIRMED' }],
      [
        'mismatched-siteId',
        { ...validEnvelope(), reference: { ...validReference(), siteId: otherUuid } },
      ],
      [
        'mismatched-cameraId',
        { ...validEnvelope(), reference: { ...validReference(), cameraId: otherUuid } },
      ],
      [
        'mismatched-sessionId',
        { ...validEnvelope(), reference: { ...validReference(), sessionId: otherUuid } },
      ],
      [
        'mismatched-sourceKind',
        { ...validEnvelope(), reference: { ...validReference(), sourceKind: 'REPLAY' } },
      ],
      [
        'mismatched-imageSha256',
        { ...validEnvelope(), reference: { ...validReference(), imageSha256: 'b'.repeat(64) } },
      ],
      ['mismatched-width', { ...validEnvelope(), reference: { ...validReference(), width: 128 } }],
      ['mismatched-height', { ...validEnvelope(), reference: { ...validReference(), height: 96 } }],
      [
        'mismatched-configurationVersion',
        { ...validEnvelope(), reference: { ...validReference(), configurationVersion: 5 } },
      ],
      [
        'mismatched-capturedAt-instant',
        {
          ...validEnvelope(),
          reference: { ...validReference(), capturedAt: '2026-10-26T05:00:00.500Z' },
        },
      ],
      [
        'mismatched-expiresAt-instant',
        {
          ...validEnvelope(),
          reference: { ...validReference(), expiresAt: '2026-10-26T05:04:59.000Z' },
        },
      ],
    ];

    for (const [label, invalid] of invalidCases) {
      assert.throws(
        () => parse(invalid),
        /Camera configuration image is unavailable or malformed/,
        label,
      );
    }
  });
});
