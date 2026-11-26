import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as previewApi from '../src/camera-preview.js';
import { PPE_ITEMS } from '../src/ppe-items.js';

const { parseCameraMediaFrame, parseCameraPreviewFrame, parseCameraPreviewResponse } = previewApi;

const localVectorsUrl = new URL(
  '../examples/camera-preview/opt-in-stream-vectors.json',
  import.meta.url,
);
const vectorsUrl = existsSync(localVectorsUrl)
  ? localVectorsUrl
  : new URL('../../examples/camera-preview/opt-in-stream-vectors.json', import.meta.url);
const vectors = JSON.parse(readFileSync(vectorsUrl, 'utf8')) as {
  status: string;
  rawMediaFrame: Record<string, unknown>;
  alignedOverlayMetadataRich: Record<string, unknown>;
  alignedOverlayMetadataMinimal: Record<string, unknown>;
};

const api = previewApi as unknown as {
  CAMERA_OVERLAY_METADATA_VERSION?: unknown;
  SUPPORTED_CAMERA_OVERLAY_METADATA_VERSIONS?: unknown;
  MAX_CAMERA_OVERLAY_METADATA_BYTES?: unknown;
  parseOptInOverlayMetadataVersion?: (value: unknown) => 1 | null;
  parseCameraOverlayMetadataFrame?: (value: unknown) => Record<string, unknown>;
  parseCameraOverlayMetadataPayload?: (payload: string | Uint8Array) => Record<string, unknown>;
  parseOptInCameraMediaStreamPacket?: (
    value: unknown,
    options?: { overlayVersion?: number },
  ) => Record<string, unknown>;
  parseOptInCameraMediaStreamPayload?: (
    payload: string | Uint8Array,
    options?: { overlayVersion?: number },
  ) => Record<string, unknown>;
  isAlignedMediaAndOverlayIdentity?: (media: unknown, metadata: unknown) => boolean;
};

const richMetadata = () => structuredClone(vectors.alignedOverlayMetadataRich);
const minimalMetadata = () => structuredClone(vectors.alignedOverlayMetadataMinimal);
const rawMedia = () => structuredClone(vectors.rawMediaFrame);

test('opt-in overlay metadata exports, constants, examples and negotiation version parser exist', () => {
  assert.equal(api.CAMERA_OVERLAY_METADATA_VERSION, 1);
  assert.deepEqual(api.SUPPORTED_CAMERA_OVERLAY_METADATA_VERSIONS, [1]);
  assert.equal(Object.isFrozen(api.SUPPORTED_CAMERA_OVERLAY_METADATA_VERSIONS), true);
  assert.equal(api.MAX_CAMERA_OVERLAY_METADATA_BYTES, 32_768);
  assert.equal(typeof api.parseOptInOverlayMetadataVersion, 'function');
  assert.equal(typeof api.parseCameraOverlayMetadataFrame, 'function');
  assert.equal(typeof api.parseCameraOverlayMetadataPayload, 'function');
  assert.equal(typeof api.parseOptInCameraMediaStreamPacket, 'function');
  assert.equal(typeof api.parseOptInCameraMediaStreamPayload, 'function');
  assert.equal(typeof api.isAlignedMediaAndOverlayIdentity, 'function');

  assert.equal(api.parseOptInOverlayMetadataVersion!(undefined), null);
  assert.equal(api.parseOptInOverlayMetadataVersion!(1), 1);
  assert.equal(api.parseOptInOverlayMetadataVersion!('1'), 1);
  for (const invalidVersion of ['', '0', '2', '01', '1.0', 0, 2, -1, 1.5, null, true, false, {}]) {
    assert.throws(
      () => api.parseOptInOverlayMetadataVersion!(invalidVersion),
      `Expected rejection for version ${JSON.stringify(invalidVersion)}`,
    );
  }
});

test('validates rich and minimal opt-in metadata packets preserving detections, raw object presence semantics and polygon revisions without image fields', () => {
  const parse = api.parseCameraOverlayMetadataFrame!;
  const parsePayload = api.parseCameraOverlayMetadataPayload!;

  const richInput = richMetadata();
  const parsedRich = parse(richInput);
  assert.deepEqual(parsedRich, richMetadata());
  assert.equal('imageDataUrl' in parsedRich, false);
  assert.equal(
    (parsedRich.zonePolygons as Array<{ geometryVersion: number }>)[0]!.geometryVersion,
    3,
  );
  const modelObjects = parsedRich.modelObjects as {
    scope: string;
    experimental: boolean;
    detections: Array<{ classId: number; className: string }>;
  };
  assert.equal(modelObjects.scope, 'OBJECT_DETECTION_ONLY');
  assert.equal(modelObjects.experimental, true);
  assert.deepEqual(
    modelObjects.detections.map((item) => item.className),
    ['NO-Hardhat', 'NO-Mask', 'fullbody-Harness', 'Lanyard-Hook'],
  );

  // Detached clone: caller mutations must never mutate parsed result or vice versa
  (richInput.detections as Array<Record<string, unknown>>)[0]!.label = 'MUTATED';
  assert.notEqual((parsedRich.detections as Array<Record<string, unknown>>)[0]!.label, 'MUTATED');

  const minimalInput = minimalMetadata();
  const parsedMinimal = parse(minimalInput);
  assert.equal('zoneAnchor' in parsedMinimal, false);
  assert.equal('modelObjects' in parsedMinimal, false);
  assert.deepEqual(parsedMinimal, minimalMetadata());

  // UTF-8 string and Uint8Array payload parsing
  const wire = JSON.stringify(richMetadata());
  assert.deepEqual(parsePayload(wire), richMetadata());
  assert.deepEqual(parsePayload(new TextEncoder().encode(wire)), richMetadata());
});

test('preserves old compatibility: legacy parsers, default stream gating, and unchanged PPE_ITEMS', () => {
  const streamParse = api.parseOptInCameraMediaStreamPacket!;
  const streamPayloadParse = api.parseOptInCameraMediaStreamPayload!;

  // Legacy parseCameraMediaFrame remains untouched
  const media = parseCameraMediaFrame(rawMedia());
  assert.equal(media.type, 'media-frame');
  assert.throws(() => parseCameraMediaFrame(richMetadata()));
  assert.throws(() =>
    parseCameraMediaFrame({
      ...rawMedia(),
      detections: [],
    }),
  );

  // Legacy preview parsers reject pixel-free overlay-metadata and accept legacy preview frames
  assert.throws(() => parseCameraPreviewFrame(richMetadata()));
  assert.throws(() =>
    parseCameraPreviewResponse({
      siteId: '11111111-1111-4111-8111-111111111111',
      cameraId: '22222222-2222-4222-8222-222222222222',
      cameraExternalId: 'CAM-NORTH-01',
      sourceKind: 'LIVE',
      frame: richMetadata(),
    }),
  );
  const legacyPreview = parseCameraPreviewResponse({
    siteId: '11111111-1111-4111-8111-111111111111',
    cameraId: '22222222-2222-4222-8222-222222222222',
    cameraExternalId: 'CAM-NORTH-01',
    sourceKind: 'REPLAY',
    frame: {
      type: 'frame',
      previewVersion: 1,
      cameraExternalId: 'CAM-NORTH-01',
      sessionId: '11111111-1111-4111-8111-111111111111',
      sequenceNumber: '1',
      capturedAt: '2026-11-27T01:30:00.000Z',
      width: 640,
      height: 360,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      detections: [],
      zoneDetections: [],
      zonePolygons: [],
    },
  });
  assert.equal(legacyPreview.sourceKind, 'REPLAY');

  // Stream multiplexer without opt-in rejects overlay-metadata but allows media-frame
  assert.equal(streamParse(rawMedia()).type, 'media-frame');
  assert.throws(() => streamParse(richMetadata()));
  assert.throws(() => streamPayloadParse(JSON.stringify(richMetadata())));

  // Opt-in stream accepts both media-frame and overlay-metadata v1 packets
  assert.equal(streamParse(rawMedia(), { overlayVersion: 1 }).type, 'media-frame');
  assert.equal(streamParse(richMetadata(), { overlayVersion: 1 }).type, 'overlay-metadata');
  assert.equal(
    streamPayloadParse(JSON.stringify(richMetadata()), { overlayVersion: 1 }).type,
    'overlay-metadata',
  );
  assert.equal(
    streamPayloadParse(JSON.stringify(rawMedia()), { overlayVersion: 1 }).type,
    'media-frame',
  );

  // Pairing identity check between media-frame and overlay-metadata
  const aligned = api.isAlignedMediaAndOverlayIdentity!;
  assert.equal(aligned(media, richMetadata()), true);
  assert.equal(aligned(media, { ...richMetadata(), capturedAt: '2026-11-27T01:30:00Z' }), true);
  assert.equal(aligned(media, { ...richMetadata(), cameraExternalId: 'CAM-OTHER' }), false);
  assert.equal(
    aligned(media, { ...richMetadata(), sessionId: '99999999-9999-4999-8999-999999999999' }),
    false,
  );
  assert.equal(aligned(media, { ...richMetadata(), sequenceNumber: '43' }), false);
  assert.equal(
    aligned(media, { ...richMetadata(), capturedAt: '2026-11-27T01:30:00.001Z' }),
    false,
  );

  assert.deepEqual(PPE_ITEMS, ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES']);
});

test('rejects wrong types, malformed identity/timestamps, REPLAY sourceKind, and image fields on metadata', () => {
  const parse = api.parseCameraOverlayMetadataFrame!;
  const parsePayload = api.parseCameraOverlayMetadataPayload!;

  for (const bad of [
    null,
    undefined,
    [],
    'string',
    42,
    { ...minimalMetadata(), type: 'media-frame' },
    { ...minimalMetadata(), type: 'frame' },
    { ...minimalMetadata(), overlayVersion: 0 },
    { ...minimalMetadata(), overlayVersion: 2 },
    { ...minimalMetadata(), overlayVersion: '1' },
    { ...minimalMetadata(), overlayVersion: true },
    { ...minimalMetadata(), sourceKind: 'REPLAY' },
    { ...minimalMetadata(), sourceKind: 'UNKNOWN' },
    { ...minimalMetadata(), cameraExternalId: '' },
    { ...minimalMetadata(), cameraExternalId: '   ' },
    { ...minimalMetadata(), cameraExternalId: 'CAM\u00001' },
    { ...minimalMetadata(), cameraExternalId: 'c'.repeat(129) },
    { ...minimalMetadata(), sessionId: 'not-a-uuid' },
    { ...minimalMetadata(), sessionId: '11111111-1111-4111-8111-11111111111' },
    { ...minimalMetadata(), sequenceNumber: '-1' },
    { ...minimalMetadata(), sequenceNumber: '01' },
    { ...minimalMetadata(), sequenceNumber: '9223372036854775808' },
    { ...minimalMetadata(), sequenceNumber: 42 },
    { ...minimalMetadata(), capturedAt: '2026-11-27 01:30:00Z' },
    { ...minimalMetadata(), capturedAt: '2026-11-27T01:30:00' },
    { ...minimalMetadata(), capturedAt: '2026-02-30T01:30:00Z' },
    { ...minimalMetadata(), width: 0 },
    { ...minimalMetadata(), width: 1281 },
    { ...minimalMetadata(), width: 640.5 },
    { ...minimalMetadata(), height: 0 },
    { ...minimalMetadata(), height: 1281 },
    { ...minimalMetadata(), zoneAnchor: null },
    { ...minimalMetadata(), zoneAnchor: 'TOP_CENTER' },
    { ...minimalMetadata(), zoneAnchor: undefined },
    { ...minimalMetadata(), modelObjects: null },
    { ...minimalMetadata(), modelObjects: undefined },
    // Image fields forbidden anywhere on metadata
    { ...minimalMetadata(), imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==' },
    { ...minimalMetadata(), image: 'abc' },
    { ...minimalMetadata(), imageSha256: 'a'.repeat(64) },
    { ...minimalMetadata(), jpegBase64: '/9j/2Q==' },
    { ...minimalMetadata(), frame: {} },
  ]) {
    assert.throws(() => parse(bad), `Expected parse failure for ${JSON.stringify(bad)}`);
  }

  // Non-JSON-safe UTF-8 / syntax
  assert.throws(() => parsePayload(new Uint8Array([0xff, 0xfe, 0xfd])));
  assert.throws(() => parsePayload('{not-json'));
});

test('rejects oversized metadata payloads and over-limit arrays cleanly', () => {
  const parse = api.parseCameraOverlayMetadataFrame!;
  const parsePayload = api.parseCameraOverlayMetadataPayload!;
  const maxBytes = api.MAX_CAMERA_OVERLAY_METADATA_BYTES as number;

  // Over 32 KiB payload byte limit (raw UTF-8 string and Uint8Array)
  const oversizedText = JSON.stringify({
    ...minimalMetadata(),
    detections: Array.from({ length: 140 }, (_, i) => ({
      trackId: i + 1,
      confidence: 0.9,
      active: true,
      label: 'MISSING HARD HAT DESCRIPTION PADDING',
      boundingBox: { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.3, coordinateSpace: 'NORMALIZED_0_1' },
      ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
      alertState: 'CONFIRMED',
      confirmedMissingItems: ['HARD_HAT'],
    })),
  });
  assert.ok(Buffer.byteLength(oversizedText, 'utf8') > maxBytes);
  assert.throws(() => parsePayload(oversizedText));
  assert.throws(() => parsePayload(new TextEncoder().encode(oversizedText)));
  assert.throws(() => parse(JSON.parse(oversizedText)));

  // Bounded realistic batch (~85 detections < 32 KiB) succeeds
  const valid85 = {
    ...minimalMetadata(),
    detections: Array.from({ length: 85 }, (_, i) => ({
      trackId: i + 1,
      confidence: 0.91,
      active: true,
      label: 'MISSING HARD HAT',
      boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' },
      ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
      alertState: 'CONFIRMED',
      confirmedMissingItems: ['HARD_HAT'],
    })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(valid85), 'utf8') < maxBytes);
  assert.equal((parse(valid85).detections as unknown[]).length, 85);

  // Over 64 zonePolygons
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      zonePolygons: Array.from({ length: 65 }, (_, i) => ({
        regionId: `region-${i}`,
        geometryVersion: 1,
        coordinates: [
          [0.1, 0.1],
          [0.2, 0.1],
          [0.2, 0.2],
        ],
      })),
    }),
  );

  // NDJSON multiplexer enforces 32 KiB on overlay-metadata even though media-frame allows 262_144
  assert.throws(() =>
    api.parseOptInCameraMediaStreamPayload!(oversizedText, { overlayVersion: 1 }),
  );
});

test('rejects unknown fields, unapproved PPE classes, and negative Harness/Hook attempts', () => {
  const parse = api.parseCameraOverlayMetadataFrame!;

  assert.throws(() => parse({ ...minimalMetadata(), unexpectedField: 1 }));
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      detections: [
        {
          trackId: 1,
          confidence: 0.9,
          active: false,
          label: 'OK',
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.4, coordinateSpace: 'NORMALIZED_0_1' },
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT', FULL_BODY_HARNESS: 'MISSING' },
        },
      ],
    }),
  );
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      detections: [
        {
          trackId: 1,
          confidence: 0.9,
          active: false,
          label: 'OK',
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.4, coordinateSpace: 'NORMALIZED_0_1' },
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
          confirmedMissingItems: ['MASK'],
        },
      ],
    }),
  );
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      modelObjects: {
        modelFamily: 'yolo11s',
        experimental: true,
        scope: 'OBJECT_DETECTION_ONLY',
        artifactId: 'art-1',
        artifactSha256: 'e'.repeat(64),
        detections: [
          {
            classId: 13,
            className: 'NO-Harness',
            confidence: 0.9,
            boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' },
          },
        ],
      },
    }),
  );
  // Mismatched classId vs className in modelObjects
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      modelObjects: {
        modelFamily: 'yolo11s',
        experimental: true,
        scope: 'OBJECT_DETECTION_ONLY',
        artifactId: 'art-1',
        artifactSha256: 'e'.repeat(64),
        detections: [
          {
            classId: 14,
            className: 'fullbody-Harness',
            confidence: 0.9,
            boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' },
          },
        ],
      },
    }),
  );
  // Missing required property inside modelObjects
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      modelObjects: {
        modelFamily: 'yolo11s',
        experimental: true,
        scope: 'POLICY_ENFORCEMENT',
        artifactId: 'art-1',
        artifactSha256: 'e'.repeat(64),
        detections: [],
      },
    }),
  );
});

test('rejects ambiguous payloads: duplicate JSON keys, conflicting versions, duplicate regionId revisions, duplicate trackIds, and contradictory PPE statuses', () => {
  const parse = api.parseCameraOverlayMetadataFrame!;
  const parsePayload = api.parseCameraOverlayMetadataPayload!;
  const streamParse = api.parseOptInCameraMediaStreamPacket!;

  // Duplicate JSON keys including unicode-escaped key
  const rawJson = JSON.stringify(minimalMetadata());
  assert.throws(() =>
    parsePayload(rawJson.replace('"overlayVersion":1', '"overlayVersion":2,"overlayVersion":1')),
  );
  assert.throws(() =>
    parsePayload(
      rawJson.replace('"overlayVersion":1', String.raw`"\u006fverlayVersion":2,"overlayVersion":1`),
    ),
  );

  // Mixed discriminators between media-frame and overlay-metadata
  assert.throws(() =>
    streamParse({ ...minimalMetadata(), mediaVersion: 1 }, { overlayVersion: 1 }),
  );
  assert.throws(() => streamParse({ ...rawMedia(), overlayVersion: 1 }, { overlayVersion: 1 }));
  assert.throws(() => parse({ ...minimalMetadata(), previewVersion: 1 }));

  // Ambiguous duplicate zonePolygon regionId (case-insensitive) across revisions
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      zonePolygons: [
        {
          regionId: '44444444-4444-4444-8444-444444444444',
          geometryVersion: 1,
          coordinates: [
            [0.1, 0.1],
            [0.5, 0.1],
            [0.5, 0.5],
          ],
        },
        {
          regionId: '44444444-4444-4444-8444-444444444444'.toUpperCase(),
          geometryVersion: 2,
          coordinates: [
            [0.1, 0.1],
            [0.6, 0.1],
            [0.6, 0.6],
          ],
        },
      ],
    }),
  );

  // Duplicate trackId within PPE detections
  const baseDet = {
    trackId: 5,
    confidence: 0.9,
    active: true,
    label: 'MISSING HARD HAT',
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' },
    ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
    alertState: 'CONFIRMED',
    confirmedMissingItems: ['HARD_HAT'],
  };
  assert.throws(() => parse({ ...minimalMetadata(), detections: [baseDet, baseDet] }));

  // Duplicate (trackId, regionId) in zoneDetections is ambiguous, whereas distinct regions for same track are valid
  const zoneDetA = {
    trackId: 5,
    confidence: 0.9,
    active: true,
    label: 'ZONE ENTRY',
    regionId: 'region-a',
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' },
    alertState: 'CONFIRMED',
  };
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      zoneDetections: [zoneDetA, { ...zoneDetA, regionId: 'REGION-A' }],
    }),
  );
  assert.equal(
    (
      parse({
        ...minimalMetadata(),
        zoneDetections: [zoneDetA, { ...zoneDetA, regionId: 'region-b' }],
      }).zoneDetections as unknown[]
    ).length,
    2,
  );

  // Contradictory PPE detection assertions
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      detections: [
        {
          ...baseDet,
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
          confirmedMissingItems: ['HARD_HAT'],
        },
      ],
    }),
  );
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      detections: [
        {
          ...baseDet,
          ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
          alertState: 'COMPLIANT',
          confirmedMissingItems: [],
        },
      ],
    }),
  );
  assert.throws(() =>
    parse({
      ...minimalMetadata(),
      detections: [
        {
          ...baseDet,
          alertState: 'CONFIRMED',
          confirmedMissingItems: [],
        },
      ],
    }),
  );
});
