import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { CameraEntity } from '../src/database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../src/database/entities/camera-observation-region.entity.js';
import { ZoneEntity } from '../src/database/entities/zone.entity.js';
import { CameraStatus, ZoneRestrictionPolicy, ZoneType } from '../src/database/entities/enums.js';
import { ObservationContextResolverService } from '../src/modules/zones/observation-context-resolver.service.js';

interface MockData {
  cameras?: CameraEntity[];
  regions?: CameraObservationRegionEntity[];
  zones?: ZoneEntity[];
}

function createMockEntityManager(data: MockData): EntityManager {
  return {
    getRepository(target: unknown) {
      if (target === CameraEntity) {
        return {
          findOneBy: async (criteria: Record<string, unknown>) => {
            return (
              data.cameras?.find((c) =>
                Object.entries(criteria).every(
                  ([k, v]) => (c as unknown as Record<string, unknown>)[k] === v,
                ),
              ) ?? null
            );
          },
        };
      }
      if (target === CameraObservationRegionEntity) {
        return {
          findOneBy: async (criteria: Record<string, unknown>) => {
            return (
              data.regions?.find((r) =>
                Object.entries(criteria).every(
                  ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
                ),
              ) ?? null
            );
          },
        };
      }
      if (target === ZoneEntity) {
        return {
          findOneBy: async (criteria: Record<string, unknown>) => {
            return (
              data.zones?.find((z) =>
                Object.entries(criteria).every(
                  ([k, v]) => (z as unknown as Record<string, unknown>)[k] === v,
                ),
              ) ?? null
            );
          },
        };
      }
      throw new Error(`Unexpected entity target in mock getRepository`);
    },
  } as unknown as EntityManager;
}

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const otherCameraId = '99999999-9999-4999-8999-999999999999';
const cameraExternalId = 'CAM-NORTH-01';
const zoneId = '33333333-3333-4333-8333-333333333333';
const regionId = '44444444-4444-4444-8444-444444444444';
const geometryVersion = 2;

const baseCamera: CameraEntity = {
  id: cameraId,
  siteId,
  externalId: cameraExternalId,
  code: 'CAM-01',
  name: 'North Gate Camera',
  status: CameraStatus.ACTIVE,
  createdAt: new Date(),
};

const baseZone: ZoneEntity = {
  id: zoneId,
  siteId,
  code: 'ZONE-RESTRICTED-A',
  name: 'Hazard Zone A',
  type: ZoneType.HAZARDOUS,
  restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  createdAt: new Date(),
};

const baseRegion: CameraObservationRegionEntity = {
  id: regionId,
  cameraId,
  zoneId,
  polygon: {
    coordinates: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  },
  coordinateSpace: 'NORMALIZED_0_1',
  version: geometryVersion,
  isActive: true,
  createdAt: new Date(),
};

test('ObservationContextResolverService: Case 1 - unknown camera returns undefined', async () => {
  const service = new ObservationContextResolverService();
  const manager = createMockEntityManager({
    cameras: [],
    regions: [baseRegion],
    zones: [baseZone],
  });

  const result = await service.resolve(manager, 'UNKNOWN_CAM', regionId, geometryVersion);
  assert.equal(result, undefined);
});

test('ObservationContextResolverService: Case 2 - region belongs to different camera returns undefined', async () => {
  const service = new ObservationContextResolverService();
  const wrongRegion: CameraObservationRegionEntity = {
    ...baseRegion,
    cameraId: otherCameraId, // belongs to different camera
  };
  const manager = createMockEntityManager({
    cameras: [baseCamera],
    regions: [wrongRegion],
    zones: [baseZone],
  });

  const result = await service.resolve(manager, cameraExternalId, regionId, geometryVersion);
  assert.equal(result, undefined);
});

test('ObservationContextResolverService: Case 3 - inactive region returns undefined', async () => {
  const service = new ObservationContextResolverService();
  const inactiveRegion: CameraObservationRegionEntity = {
    ...baseRegion,
    isActive: false, // inactive region
  };
  const manager = createMockEntityManager({
    cameras: [baseCamera],
    regions: [inactiveRegion],
    zones: [baseZone],
  });

  const result = await service.resolve(manager, cameraExternalId, regionId, geometryVersion);
  assert.equal(result, undefined);
});

test('ObservationContextResolverService: Case 4 - geometry version mismatch returns undefined', async () => {
  const service = new ObservationContextResolverService();
  const manager = createMockEntityManager({
    cameras: [baseCamera],
    regions: [baseRegion], // version is 2
    zones: [baseZone],
  });

  // Requesting version 1 instead of 2
  const result = await service.resolve(manager, cameraExternalId, regionId, 1);
  assert.equal(result, undefined);

  // Requesting version 3 instead of 2
  const resultHigher = await service.resolve(manager, cameraExternalId, regionId, 3);
  assert.equal(resultHigher, undefined);
});

test('ObservationContextResolverService: Case 5 - valid camera + region + version returns correct siteId and Zone', async () => {
  const service = new ObservationContextResolverService();
  const manager = createMockEntityManager({
    cameras: [baseCamera],
    regions: [baseRegion],
    zones: [baseZone],
  });

  const result = await service.resolve(manager, cameraExternalId, regionId, geometryVersion);
  assert.ok(result !== undefined);
  assert.equal(result.cameraId, cameraId);
  assert.equal(result.siteId, siteId);
  assert.equal(result.regionId, regionId);
  assert.equal(result.zoneId, zoneId);
  assert.deepEqual(result.zone, baseZone);
});

test('ObservationContextResolverService: missing region returns undefined', async () => {
  const service = new ObservationContextResolverService();
  const manager = createMockEntityManager({
    cameras: [baseCamera],
    regions: [], // no regions
    zones: [baseZone],
  });

  const result = await service.resolve(manager, cameraExternalId, regionId, geometryVersion);
  assert.equal(result, undefined);
});

test('ObservationContextResolverService: missing zone returns undefined', async () => {
  const service = new ObservationContextResolverService();
  const manager = createMockEntityManager({
    cameras: [baseCamera],
    regions: [baseRegion],
    zones: [], // no zone
  });

  const result = await service.resolve(manager, cameraExternalId, regionId, geometryVersion);
  assert.equal(result, undefined);
});

test('ObservationContextResolverService: resolveCamera returns camera entity when found and undefined otherwise', async () => {
  const service = new ObservationContextResolverService();
  const manager = createMockEntityManager({
    cameras: [baseCamera],
  });

  const found = await service.resolveCamera(manager, cameraExternalId);
  assert.deepEqual(found, baseCamera);

  const notFound = await service.resolveCamera(manager, 'UNKNOWN');
  assert.equal(notFound, undefined);
});
