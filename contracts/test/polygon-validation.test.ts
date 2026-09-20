import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeCanonicalPayloadHash,
  parseCameraRegionConfigurationPayload,
} from '@smartsite/contracts';
import type { CameraRegionConfiguration, NormalizedCoordinate } from '@smartsite/contracts';
import { validateCameraRegionPolygons } from '../src/validation/polygon-validator.js';

function configuration(coordinates: readonly NormalizedCoordinate[]): CameraRegionConfiguration {
  return {
    schemaVersion: '1.0.0',
    configurationVersion: 42,
    cameraExternalId: 'CAM-GATE-01',
    regions: [
      {
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 3,
        coordinateSpace: 'NORMALIZED_0_1',
        polygon: { coordinates },
      },
    ],
  };
}

const invalidPolygons: Array<[string, readonly NormalizedCoordinate[]]> = [
  [
    'exactly collinear triangle despite floating-point cancellation',
    [
      [450000004 / 2 ** 30, 123000000 / 2 ** 30],
      [450010005 / 2 ** 30, 123020002 / 2 ** 30],
      [450020006 / 2 ** 30, 123040004 / 2 ** 30],
    ],
  ],
  [
    'repeated closing vertex',
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ],
  ],
  [
    'repeated interior vertex',
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 0],
      [0, 1],
    ],
  ],
  [
    'collinear zero area',
    [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ],
  ],
  [
    'bow-tie self-intersection',
    [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ],
  ],
  [
    'nonzero-area self-intersection',
    [
      [0, 0],
      [1, 1],
      [0, 1],
      [0.5, 0],
    ],
  ],
  [
    'non-adjacent endpoint touching an edge',
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0.5, 0],
      [0, 1],
    ],
  ],
  [
    'collinear overlapping non-adjacent edges',
    [
      [0, 0],
      [0.75, 0],
      [0.75, 1],
      [0.25, 0],
      [1, 0],
      [0, 1],
    ],
  ],
];

for (const [name, coordinates] of invalidPolygons) {
  test(`rejects ${name} with a polygon path`, () => {
    const input = configuration(coordinates);
    const issues = validateCameraRegionPolygons(input);
    assert.equal(issues[0]?.code, 'INVALID_GEOMETRY');
    assert.equal(issues[0]?.path, '/regions/0/polygon/coordinates');

    const result = parseCameraRegionConfigurationPayload(JSON.stringify(input));
    assert.equal(result.isValid, false);
    assert.equal(result.issues[0]?.path, '/regions/0/polygon/coordinates');
    assert.equal(Object.hasOwn(result, 'value'), false);
  });
}

const validPolygons: Array<[string, readonly NormalizedCoordinate[]]> = [
  [
    'tiny triangle despite floating-point cancellation',
    [
      [0.5, 0.5],
      [0.500000001, 0.5],
      [0.5, 0.500000001],
    ],
  ],
  [
    'triangle with subnormal coordinates and area below Number.MIN_VALUE',
    [
      [0, 0],
      [Number.MIN_VALUE, 0],
      [0, Number.MIN_VALUE],
    ],
  ],
  [
    'counter-clockwise square',
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ],
  [
    'clockwise square',
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ],
  ],
  [
    'concave polygon',
    [
      [0, 0],
      [1, 0],
      [0.5, 0.5],
      [1, 1],
      [0, 1],
    ],
  ],
  [
    'collinear adjacent edges',
    [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ],
];

for (const [name, coordinates] of validPolygons) {
  test(`accepts ${name} without closing or reordering coordinates`, () => {
    const input = configuration(coordinates);
    const before = structuredClone(input);
    assert.deepEqual(validateCameraRegionPolygons(input), []);
    assert.deepEqual(input, before);
    assert.deepEqual(parseCameraRegionConfigurationPayload(JSON.stringify(input)), {
      isValid: true,
      issues: [],
      value: before,
    });
  });
}

test('rejects duplicate region IDs with different content before polygon traversal', () => {
  const input = configuration([
    [0, 0],
    [0.5, 0.5],
    [1, 1],
  ]);
  const duplicate = {
    ...input,
    regions: [input.regions[0], { ...input.regions[0], geometryVersion: 4 }],
  };
  const issues = validateCameraRegionPolygons(duplicate);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'DUPLICATE_REGION_ID');
  assert.equal(issues[0]?.path, '/regions/1/regionId');
  const result = parseCameraRegionConfigurationPayload(JSON.stringify(duplicate));
  assert.deepEqual(result, { isValid: false, issues });
});

test('reports the polygon path for a later region', () => {
  const valid = configuration([
    [0, 0],
    [1, 0],
    [0, 1],
  ]);
  const invalid = configuration([
    [0, 0],
    [0.5, 0.5],
    [1, 1],
  ]);
  const result = parseCameraRegionConfigurationPayload(
    JSON.stringify({
      ...valid,
      regions: [
        valid.regions[0],
        { ...invalid.regions[0], regionId: '00000000-0000-4000-8000-000000000001' },
      ],
    }),
  );
  assert.equal(result.issues[0]?.code, 'INVALID_GEOMETRY');
  assert.equal(result.issues[0]?.path, '/regions/1/polygon/coordinates');
  assert.equal(Object.hasOwn(result, 'value'), false);
});

const underflowPolygons: Array<[string, readonly NormalizedCoordinate[], boolean]> = [
  [
    'nonzero-area crossing below floating-point product range',
    [
      [0, 1e-200],
      [2e-200, 1e-200],
      [1e-200, 0],
      [1e-200, 3e-200],
    ],
    false,
  ],
  [
    'valid parallelogram below floating-point product range',
    [
      [0, 0],
      [3e-200, 2e-200],
      [3e-200, 3e-200],
      [0, 1e-200],
    ],
    true,
  ],
];

for (const [name, coordinates, valid] of underflowPolygons) {
  test(`semantic validator handles ${name}`, () => {
    const issues = validateCameraRegionPolygons(configuration(coordinates));
    if (valid) {
      assert.deepEqual(issues, []);
    } else {
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.code, 'INVALID_GEOMETRY');
      assert.equal(issues[0]?.path, '/regions/0/polygon/coordinates');
    }
  });

  test(`public parser handles ${name}`, () => {
    const input = configuration(coordinates);
    const result = parseCameraRegionConfigurationPayload(JSON.stringify(input));
    assert.equal(result.isValid, valid);
    if (valid) {
      assert.deepEqual(result.value, input);
      assert.deepEqual(result.issues, []);
    } else {
      assert.equal(result.issues[0]?.code, 'INVALID_GEOMETRY');
      assert.equal(result.issues[0]?.path, '/regions/0/polygon/coordinates');
      assert.equal(Object.hasOwn(result, 'value'), false);
    }
  });
}

for (const boundary of ['semantic validator', 'public parser'] as const) {
  test(`${boundary} rejects case-equivalent UUIDs without changing their text`, () => {
    const input = configuration([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    const duplicate = {
      ...input,
      regions: [
        input.regions[0],
        { ...input.regions[0], regionId: input.regions[0].regionId.toUpperCase() },
      ],
    };
    const before = structuredClone(duplicate);
    const result =
      boundary === 'public parser'
        ? parseCameraRegionConfigurationPayload(JSON.stringify(duplicate))
        : undefined;
    if (result) {
      assert.equal(result.isValid, false);
      assert.equal(Object.hasOwn(result, 'value'), false);
    }
    const issues = result?.issues ?? validateCameraRegionPolygons(duplicate);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.code, 'DUPLICATE_REGION_ID');
    assert.equal(issues[0]?.path, '/regions/1/regionId');
    assert.deepEqual(duplicate, before);
  });
}

test('preserves uppercase UUID spelling in accepted payloads and canonical hashing', () => {
  const lowercase = configuration([
    [0, 0],
    [1, 0],
    [0, 1],
  ]);
  const uppercase = {
    ...lowercase,
    regions: [{ ...lowercase.regions[0], regionId: lowercase.regions[0].regionId.toUpperCase() }],
  };
  const result = parseCameraRegionConfigurationPayload(JSON.stringify(uppercase));
  assert.deepEqual(result, { isValid: true, issues: [], value: uppercase });
  assert.notEqual(
    computeCanonicalPayloadHash(result.value),
    computeCanonicalPayloadHash(lowercase),
  );
});
