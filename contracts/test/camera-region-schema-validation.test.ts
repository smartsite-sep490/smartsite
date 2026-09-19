import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCameraRegionConfiguration } from '@smartsite/contracts';

function region(index = 0) {
  return {
    regionId:
      index === 0
        ? 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6'
        : `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
    geometryVersion: 3,
    coordinateSpace: 'NORMALIZED_0_1',
    polygon: {
      coordinates: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.5, 0.9],
      ],
    },
  };
}

function without(object: Record<string, unknown>, property: string) {
  const copy = { ...object };
  delete copy[property];
  return copy;
}

function baseConfiguration() {
  return {
    schemaVersion: '1.0.0',
    configurationVersion: 42,
    cameraExternalId: 'CAM-GATE-01',
    regions: [region()],
  };
}

test('accepts a valid camera region configuration', () => {
  assert.equal(validateCameraRegionConfiguration(baseConfiguration()).isValid, true);
});

test('rejects unexpected root properties', () => {
  assert.equal(
    validateCameraRegionConfiguration({ ...baseConfiguration(), unexpected: true }).isValid,
    false,
  );
});

test('rejects more than 64 regions', () => {
  assert.equal(
    validateCameraRegionConfiguration({
      ...baseConfiguration(),
      regions: Array.from({ length: 65 }, (_, index) => region(index)),
    }).isValid,
    false,
  );
});

test('rejects malformed camera region configuration structure', () => {
  const configuration = baseConfiguration();
  const firstRegion = configuration.regions[0];

  const invalidConfigurations: Array<[string, unknown]> = [
    ['missing schemaVersion', without(configuration, 'schemaVersion')],
    ['missing configurationVersion', without(configuration, 'configurationVersion')],
    ['missing cameraExternalId', without(configuration, 'cameraExternalId')],
    ['missing regions', without(configuration, 'regions')],
    ['missing regionId', { ...configuration, regions: [without(firstRegion, 'regionId')] }],
    ['missing geometryVersion', { ...configuration, regions: [without(firstRegion, 'geometryVersion')] }],
    ['missing coordinateSpace', { ...configuration, regions: [without(firstRegion, 'coordinateSpace')] }],
    ['missing polygon', { ...configuration, regions: [without(firstRegion, 'polygon')] }],
    ['missing coordinates', { ...configuration, regions: [{ ...firstRegion, polygon: without(firstRegion.polygon, 'coordinates') }] }],
    ['configurationVersion zero', { ...configuration, configurationVersion: 0 }],
    ['unsafe configurationVersion', { ...configuration, configurationVersion: Number.MAX_SAFE_INTEGER + 1 }],
    ['empty cameraExternalId', { ...configuration, cameraExternalId: '' }],
    ['overlong cameraExternalId', { ...configuration, cameraExternalId: 'C'.repeat(129) }],
    ['more than 64 regions', { ...configuration, regions: Array.from({ length: 65 }, (_, index) => region(index)) }],
    ['duplicate region content', { ...configuration, regions: [firstRegion, { ...firstRegion, polygon: { coordinates: [...firstRegion.polygon.coordinates] } }] }],
    ['inactive-region property', { ...configuration, regions: [{ ...firstRegion, isActive: false }] }],
    ['geometryVersion zero', { ...configuration, regions: [{ ...firstRegion, geometryVersion: 0 }] }],
    ['unsafe geometryVersion', { ...configuration, regions: [{ ...firstRegion, geometryVersion: Number.MAX_SAFE_INTEGER + 1 }] }],
    ['two vertices', { ...configuration, regions: [{ ...firstRegion, polygon: { coordinates: [[0.1, 0.1], [0.9, 0.1]] } }] }],
    ['65 vertices', { ...configuration, regions: [{ ...firstRegion, polygon: { coordinates: Array.from({ length: 65 }, (_, index) => [index / 64, 0.1]) } }] }],
    ['out-of-range coordinate', { ...configuration, regions: [{ ...firstRegion, polygon: { coordinates: [[-0.1, 0.1], [0.9, 0.1], [0.5, 0.9]] } }] }],
    ['non-finite coordinate', { ...configuration, regions: [{ ...firstRegion, polygon: { coordinates: [[Number.NaN, 0.1], [0.9, 0.1], [0.5, 0.9]] } }] }],
    ['infinite coordinate', { ...configuration, regions: [{ ...firstRegion, polygon: { coordinates: [[Number.POSITIVE_INFINITY, 0.1], [0.9, 0.1], [0.5, 0.9]] } }] }],
    ['third coordinate tuple item', { ...configuration, regions: [{ ...firstRegion, polygon: { coordinates: [[0.1, 0.1, 0.2], [0.9, 0.1], [0.5, 0.9]] } }] }],
    ['duplicate coordinate', { ...configuration, regions: [{ ...firstRegion, polygon: { coordinates: [[0.1, 0.1], [0.1, 0.1], [0.5, 0.9]] } }] }],
    ['unexpected region property', { ...configuration, regions: [{ ...firstRegion, unexpected: true }] }],
    ['unexpected polygon property', { ...configuration, regions: [{ ...firstRegion, polygon: { ...firstRegion.polygon, unexpected: true } }] }],
  ];

  for (const [name, invalidConfiguration] of invalidConfigurations) {
    assert.equal(validateCameraRegionConfiguration(invalidConfiguration).isValid, false, name);
  }
});
