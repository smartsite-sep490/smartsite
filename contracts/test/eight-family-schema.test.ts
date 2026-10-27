import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  validateEightFamilyObservationEvent,
  validateObservationEvent,
} from '../src/validation/schema-validator.js';

const REGION_ID = '99999999-8888-4777-8666-555555555555';
const SHA_FRAME = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SHA_CROP = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const SHA_SNAPSHOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const EIGHT_PPE_ITEMS = [
  'HARD_HAT',
  'SAFETY_VEST',
  'GLOVES',
  'BOOTS',
  'GOGGLES',
  'MASK',
  'FULL_BODY_HARNESS',
  'LANYARD_HOOK',
] as const;

const NEW_THREE_PPE_ITEMS = ['MASK', 'FULL_BODY_HARNESS', 'LANYARD_HOOK'] as const;
const POSITIVE_ONLY_PPE_ITEMS = ['FULL_BODY_HARNESS', 'LANYARD_HOOK'] as const;

function makePpeObservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'PPE',
    trackId: 7,
    ppeItem: 'HARD_HAT',
    status: 'PRESENT',
    regionId: REGION_ID,
    geometryVersion: 3,
    confidence: 0.94,
    boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
    ...overrides,
  };
}

function buildV13Event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: '11111111-2222-4333-8444-555555555555',
    schemaVersion: '1.3.0',
    cameraExternalId: 'cam-zone-north-01',
    streamSessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    capturedAt: '2026-10-20T06:00:00.000Z',
    frameDimensions: { width: 1920, height: 1080 },
    observations: [makePpeObservation()],
    evidence: [{ kind: 'FRAME', uri: 'local://frames/f1.jpg', sha256: SHA_FRAME }],
    ...overrides,
  };
}

describe('Observation Event v1.3 Eight-Family PPE Contract', () => {
  it('1. accepts v1.3.0 with separate PERSON, all 8 PPE families, explicit MASK MISSING, and PRESENT harness/hook', () => {
    const observations: Record<string, unknown>[] = [
      {
        type: 'PERSON',
        trackId: 7,
        confidence: 0.98,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
      },
      ...EIGHT_PPE_ITEMS.map((ppeItem) => makePpeObservation({ ppeItem, status: 'PRESENT' })),
      makePpeObservation({ ppeItem: 'MASK', status: 'MISSING' }),
    ];

    const result = validateEightFamilyObservationEvent(buildV13Event({ observations }));
    assert.equal(
      result.isValid,
      true,
      `Expected valid v1.3 eight-family event, got: ${JSON.stringify(result.issues)}`,
    );
    assert.deepEqual(result.issues, []);
  });

  it('2. rejects MISSING or UNKNOWN status and missing required PPE fields for FULL_BODY_HARNESS and LANYARD_HOOK in v1.3.0', () => {
    for (const ppeItem of POSITIVE_ONLY_PPE_ITEMS) {
      for (const badStatus of ['MISSING', 'UNKNOWN']) {
        const badStatusEvent = buildV13Event({
          observations: [makePpeObservation({ ppeItem, status: badStatus })],
        });
        const statusResult = validateEightFamilyObservationEvent(badStatusEvent);
        assert.equal(
          statusResult.isValid,
          false,
          `${ppeItem} with status=${badStatus} must be rejected`,
        );
      }

      for (const requiredKey of ['trackId', 'regionId', 'geometryVersion'] as const) {
        const obs = makePpeObservation({ ppeItem, status: 'PRESENT' });
        delete obs[requiredKey];
        const missingFieldResult = validateEightFamilyObservationEvent(
          buildV13Event({ observations: [obs] }),
        );
        assert.equal(
          missingFieldResult.isValid,
          false,
          `${ppeItem} missing ${requiredKey} must be rejected`,
        );
      }
    }
  });

  it('3. keeps validateObservationEvent rejecting v1.3.0 and new 3 PPE items in v1.2.0 while preserving v1/v1.1/v1.2 schemas', () => {
    assert.equal(
      validateObservationEvent(buildV13Event()).isValid,
      false,
      'Existing validateObservationEvent must not auto-admit v1.3.0',
    );

    for (const oldVersion of ['1.0.0', '1.1.0', '1.2.0'] as const) {
      assert.equal(
        validateEightFamilyObservationEvent(buildV13Event({ schemaVersion: oldVersion })).isValid,
        false,
        `validateEightFamilyObservationEvent must reject schemaVersion=${oldVersion}`,
      );
    }

    for (const ppeItem of NEW_THREE_PPE_ITEMS) {
      const v12WithNewItem = buildV13Event({
        schemaVersion: '1.2.0',
        observations: [makePpeObservation({ ppeItem, status: 'PRESENT' })],
      });
      assert.equal(
        validateObservationEvent(v12WithNewItem).isValid,
        false,
        `v1.2.0 must reject ${ppeItem}`,
      );
    }

    for (const [folder, version] of [
      ['v1', '1.0.0'],
      ['v1.1', '1.1.0'],
      ['v1.2', '1.2.0'],
    ] as const) {
      const schemaUrl = new URL(
        `../../schemas/${folder}/technical-observation-event.json`,
        import.meta.url,
      );
      const raw = JSON.parse(readFileSync(schemaUrl, 'utf8')) as {
        properties: { schemaVersion: { const: string } };
        $defs: { ppeObservation: { properties: { ppeItem: { enum: string[] } } } };
      };
      assert.equal(raw.properties.schemaVersion.const, version);
      for (const ppeItem of NEW_THREE_PPE_ITEMS) {
        assert.equal(raw.$defs.ppeObservation.properties.ppeItem.enum.includes(ppeItem), false);
      }
    }
  });

  it('4. enforces required sha256 across FRAME, CROP, and SNAPSHOT evidence, geometry bounds, and rejects unknown version 1.4.0', () => {
    const validAllKinds = buildV13Event({
      evidence: [
        { kind: 'FRAME', uri: 'local://frames/f1.jpg', sha256: SHA_FRAME },
        { kind: 'CROP', uri: 'local://crops/c1.jpg', sha256: SHA_CROP },
        { kind: 'SNAPSHOT', uri: 'local://snapshots/s1.jpg', sha256: SHA_SNAPSHOT },
      ],
    });
    assert.equal(validateEightFamilyObservationEvent(validAllKinds).isValid, true);

    for (const kind of ['FRAME', 'CROP', 'SNAPSHOT'] as const) {
      const missingSha = buildV13Event({ evidence: [{ kind, uri: 'local://media/m.jpg' }] });
      const missingRes = validateEightFamilyObservationEvent(missingSha);
      assert.equal(missingRes.isValid, false);
      assert.ok(missingRes.issues.some((i) => i.path === '/evidence/0/sha256'));
      for (const sha256 of [SHA_FRAME + '\n', SHA_FRAME.toUpperCase(), SHA_FRAME.slice(1)]) {
        assert.equal(
          validateEightFamilyObservationEvent(
            buildV13Event({
              evidence: [{ kind, uri: 'local://media/m.jpg', sha256 }],
            }),
          ).isValid,
          false,
        );
      }
    }

    const badGeometry = buildV13Event({
      observations: [
        makePpeObservation({
          ppeItem: 'FULL_BODY_HARNESS',
          boundingBox: { x1: 0.7, y1: 0.2, x2: 0.7, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
        }),
      ],
    });
    const geomRes = validateEightFamilyObservationEvent(badGeometry);
    assert.equal(geomRes.isValid, false);
    assert.ok(geomRes.issues.some((i) => i.code === 'INVALID_GEOMETRY'));

    assert.equal(
      validateEightFamilyObservationEvent(buildV13Event({ schemaVersion: '1.4.0' })).isValid,
      false,
    );
    assert.equal(
      validateObservationEvent(buildV13Event({ schemaVersion: '1.4.0' })).isValid,
      false,
    );
  });
});
