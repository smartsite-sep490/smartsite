import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { EntitySubscriberInterface } from 'typeorm';
import dataSource from '../support/test-data-source.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import {
  CameraStatus,
  ZoneRestrictionPolicy,
  ZoneType,
} from '../../src/database/entities/enums.js';
import { parseCameraRegionConfigurationPayload } from '@smartsite/contracts';
import { CameraRegionConfiguration1790035200000 } from '../../src/database/migrations/1790035200000-CameraRegionConfiguration.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { createTestConfig } from '../support/config.js';
import { AiIngestionService } from '../../src/integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from '../../src/modules/zones/observation-context-resolver.service.js';
import { ZoneAuthorizationService } from '../../src/modules/zones/zone-authorization.service.js';
import { AlertCandidateEvaluator } from '../../src/modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { CameraObservationRegionEntity } from '../../src/database/entities/camera-observation-region.entity.js';
import { CameraEntity } from '../../src/database/entities/camera.entity.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

const triangle = {
  coordinates: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
};
const isConflict = (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === 'CONFLICT';
const isNotFound = (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === 'NOT_FOUND';
const isInvalid = (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED';

async function seed() {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const sites = new SiteConfigurationService(dataSource);
  const zones = new ZoneConfigurationService(dataSource, sites);
  const cameras = new CameraConfigurationService(dataSource, zones, sites);
  const suffix = randomUUID().slice(0, 8);
  const site = await sites.create({ code: `SITE-${suffix}`, name: 'Site A' });
  const camera = await cameras.create(site.id, {
    code: `CAM-${suffix}`,
    externalId: `AI-CAM-${suffix}`,
    name: 'Gate',
  });
  const zone = await zones.create(site.id, {
    code: `ZONE-${suffix}`,
    name: 'Gate zone',
    type: ZoneType.RESTRICTED,
    restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
    requiredPpe: ['HARD_HAT'],
  });
  return { sites, zones, cameras, site, camera, zone };
}

test('creates a Site, Camera, Zone and Region, then builds the AI contract snapshot', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const sites = new SiteConfigurationService(dataSource);
  const zones = new ZoneConfigurationService(dataSource, sites);
  const cameras = new CameraConfigurationService(dataSource, zones, sites);
  const suffix = randomUUID().slice(0, 8);
  const site = await sites.create({ code: `SITE-${suffix}`, name: 'Site A' });
  const camera = await cameras.create(site.id, {
    code: `CAM-${suffix}`,
    externalId: `AI-CAM-${suffix}`,
    name: 'Gate',
  });
  const zone = await zones.create(site.id, {
    code: `ZONE-${suffix}`,
    name: 'Gate zone',
    type: ZoneType.RESTRICTED,
    restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
    requiredPpe: ['HARD_HAT'],
  });
  const region = await cameras.createRegion(site.id, camera.id, {
    zoneId: zone.id,
    polygon: {
      coordinates: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    },
    expectedConfigurationVersion: 1,
  });
  const snapshot = await cameras.buildConfiguration(site.id, camera.id);
  assert.equal(snapshot.configurationVersion, 2);
  assert.equal(snapshot.regions[0]?.regionId, region.id);
  assert.equal(parseCameraRegionConfigurationPayload(JSON.stringify(snapshot)).isValid, true);
  assert.equal((await zones.get(site.id, zone.id)).configurationLocked, true);
  await cameras.updatePolygon(site.id, camera.id, region.id, {
    polygon: triangle,
    expectedConfigurationVersion: 2,
  });
  await cameras.setRegionActive(site.id, camera.id, region.id, {
    isActive: true,
    expectedConfigurationVersion: 2,
  });
  await cameras.setStatus(site.id, camera.id, {
    status: CameraStatus.ACTIVE,
    expectedConfigurationVersion: 2,
  });
  assert.equal((await cameras.get(site.id, camera.id)).configurationVersion, 2);
  assert.equal((await cameras.getRegion(site.id, camera.id, region.id)).version, 1);
});

test('metadata operations keep identity and revision stable, and known duplicate codes conflict', async () => {
  const { sites, zones, cameras, site, camera, zone } = await seed();
  await assert.rejects(sites.create({ code: site.code, name: 'Duplicate' }), isConflict);
  await assert.rejects(
    cameras.create(site.id, { code: 'OTHER', externalId: camera.externalId, name: 'Duplicate' }),
    isConflict,
  );
  await assert.rejects(
    zones.create(site.id, {
      code: zone.code,
      name: 'Duplicate',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: [],
    }),
    isConflict,
  );
  await sites.rename(site.id, { name: ' New site ' });
  await cameras.rename(site.id, camera.id, { name: ' New camera ' });
  await zones.rename(site.id, zone.id, { name: ' New zone ' });
  assert.equal((await sites.get(site.id)).name, 'New site');
  assert.equal((await cameras.get(site.id, camera.id)).name, 'New camera');
  assert.equal((await zones.get(site.id, zone.id)).name, 'New zone');
  assert.equal((await cameras.get(site.id, camera.id)).configurationVersion, 1);
  // The test database may already have more than 100 Sites from previous runs.
  assert.equal((await sites.list(0, 1)).items.length, 1);
  assert.equal((await cameras.list(site.id)).total, 1);
  assert.equal((await zones.list(site.id)).total, 1);
  assert.deepEqual(await cameras.listRegions(site.id, camera.id), { items: [], total: 0 });
});

test('zone policy is editable before linking and stays locked after region deactivation', async () => {
  const { zones, cameras, site, camera, zone } = await seed();
  const policy = {
    type: ZoneType.HAZARDOUS,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    requiredPpe: ['SAFETY_VEST'],
  };
  assert.equal(
    (await zones.updatePolicy(site.id, zone.id, policy)).restrictionPolicy,
    ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  );
  const region = await cameras.createRegion(site.id, camera.id, {
    zoneId: zone.id,
    polygon: triangle,
    expectedConfigurationVersion: 1,
  });
  await cameras.setRegionActive(site.id, camera.id, region.id, {
    isActive: false,
    expectedConfigurationVersion: 2,
  });
  assert.equal((await zones.updatePolicy(site.id, zone.id, policy)).configurationLocked, true);
  await assert.rejects(
    zones.updatePolicy(site.id, zone.id, {
      ...policy,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
    }),
    isConflict,
  );
  assert.equal((await zones.rename(site.id, zone.id, { name: 'Renamed' })).name, 'Renamed');
});

test('simultaneous policy edit and first region link serialize without changing policy after lock', async () => {
  const { zones, cameras, site, camera, zone } = await seed();
  const results = await Promise.allSettled([
    zones.updatePolicy(site.id, zone.id, {
      type: ZoneType.HAZARDOUS,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      requiredPpe: [],
    }),
    cameras.createRegion(site.id, camera.id, {
      zoneId: zone.id,
      polygon: triangle,
      expectedConfigurationVersion: 1,
    }),
  ]);
  assert.equal(results[1]?.status, 'fulfilled');
  const stored = await zones.get(site.id, zone.id);
  assert.equal(stored.configurationLocked, true);
  if (results[0]?.status === 'fulfilled')
    assert.equal(stored.restrictionPolicy, ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED);
  else {
    assert.ok(results[0]?.status === 'rejected' && isConflict(results[0].reason));
    assert.equal(stored.restrictionPolicy, ZoneRestrictionPolicy.PROHIBITED_FOR_ALL);
  }
});

test('rejects invalid polygons and cross-site access without changing revision or policy', async () => {
  const { zones, cameras, site, camera, zone } = await seed();
  const other = await seed();
  await assert.rejects(cameras.get(other.site.id, camera.id), isNotFound);
  await assert.rejects(zones.get(other.site.id, zone.id), isNotFound);
  await assert.rejects(
    cameras.createRegion(site.id, camera.id, {
      zoneId: other.zone.id,
      polygon: triangle,
      expectedConfigurationVersion: 1,
    }),
    isNotFound,
  );
  await assert.rejects(
    cameras.createRegion(site.id, camera.id, {
      zoneId: zone.id,
      polygon: {
        coordinates: [
          [0, 0],
          [1, 1],
          [0, 1],
          [1, 0],
        ],
      },
      expectedConfigurationVersion: 1,
    }),
    isInvalid,
  );
  assert.equal((await cameras.get(site.id, camera.id)).configurationVersion, 1);
  assert.equal((await zones.get(site.id, zone.id)).configurationLocked, false);
});

test('stale revisions lose, and geometry or activation never reuses a previous version', async () => {
  const { cameras, site, camera, zone } = await seed();
  const region = await cameras.createRegion(site.id, camera.id, {
    zoneId: zone.id,
    polygon: triangle,
    expectedConfigurationVersion: 1,
  });
  const results = await Promise.allSettled([
    cameras.updatePolygon(site.id, camera.id, region.id, {
      polygon: {
        coordinates: [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
      },
      expectedConfigurationVersion: 2,
    }),
    cameras.setRegionActive(site.id, camera.id, region.id, {
      isActive: false,
      expectedConfigurationVersion: 2,
    }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && isConflict(rejected.reason));
  const current = await cameras.getRegion(site.id, camera.id, region.id);
  assert.equal(current.version, 2);
  const revision = (await cameras.get(site.id, camera.id)).configurationVersion;
  assert.equal(revision, 3);
  const toggled = await cameras.setRegionActive(site.id, camera.id, region.id, {
    isActive: !current.isActive,
    expectedConfigurationVersion: revision,
  });
  assert.equal((await cameras.getRegion(site.id, camera.id, region.id)).version, 3);
  if (!toggled.isActive)
    await cameras.setRegionActive(site.id, camera.id, region.id, {
      isActive: true,
      expectedConfigurationVersion: 4,
    });
  const beforeCamera = await cameras.get(site.id, camera.id);
  const beforeRegion = await cameras.getRegion(site.id, camera.id, region.id);
  await cameras.setStatus(site.id, camera.id, {
    status: CameraStatus.INACTIVE,
    expectedConfigurationVersion: beforeCamera.configurationVersion,
  });
  assert.equal((await cameras.get(site.id, camera.id)).status, CameraStatus.INACTIVE);
  await assert.rejects(cameras.buildConfiguration(site.id, camera.id), isConflict);
  await cameras.setStatus(site.id, camera.id, {
    status: CameraStatus.ACTIVE,
    expectedConfigurationVersion: beforeCamera.configurationVersion + 1,
  });
  assert.equal((await cameras.get(site.id, camera.id)).status, CameraStatus.ACTIVE);
  assert.equal(
    (await cameras.getRegion(site.id, camera.id, region.id)).version,
    beforeRegion.version + 2,
  );
});

test('migration backfills locks for inactive regions and preserves region identity/version', async () => {
  const { zones: zoneService, cameras, site, camera, zone } = await seed();
  const region = await cameras.createRegion(site.id, camera.id, {
    zoneId: zone.id,
    polygon: triangle,
    expectedConfigurationVersion: 1,
  });
  await cameras.setRegionActive(site.id, camera.id, region.id, {
    isActive: false,
    expectedConfigurationVersion: 2,
  });
  const unlinked = await zoneService.create(site.id, {
    code: 'UNLINKED',
    name: 'Unlinked',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.NONE,
    requiredPpe: [],
  });
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const migration = new CameraRegionConfiguration1790035200000();
    await migration.down(runner);
    await migration.up(runner);
    const zones = (await runner.query('SELECT configuration_locked FROM zone WHERE id = $1', [
      zone.id,
    ])) as { configuration_locked: boolean }[];
    assert.equal(zones[0]?.configuration_locked, true);
    const rows = (await runner.query('SELECT configuration_version FROM camera WHERE id = $1', [
      camera.id,
    ])) as { configuration_version: string }[];
    assert.equal(Number(rows[0]?.configuration_version), 1);
    const unlinkedRows = (await runner.query(
      'SELECT configuration_locked FROM zone WHERE id = $1',
      [unlinked.id],
    )) as { configuration_locked: boolean }[];
    assert.equal(unlinkedRows[0]?.configuration_locked, false);
    const regions = (await runner.query(
      'SELECT id, version, is_active FROM camera_observation_region WHERE id = $1',
      [region.id],
    )) as { id: string; version: number; is_active: boolean }[];
    assert.deepEqual(regions, [{ id: region.id, version: 2, is_active: false }]);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
});

test('ingestion rejects stale geometry across polygon edits and Region/Camera lifecycle changes', async () => {
  const { cameras, site, camera, zone } = await seed();
  const region = await cameras.createRegion(site.id, camera.id, {
    zoneId: zone.id,
    polygon: triangle,
    expectedConfigurationVersion: 1,
  });
  await cameras.updatePolygon(site.id, camera.id, region.id, {
    polygon: {
      coordinates: [
        [0, 0],
        [1, 0],
        [0.5, 1],
      ],
    },
    expectedConfigurationVersion: 2,
  });
  const resolver = new ObservationContextResolverService();
  const evaluator = new AlertCandidateEvaluator(new ZoneAuthorizationService());
  const ingestion = new AiIngestionService(
    dataSource,
    resolver,
    evaluator,
    new DurableGroupingService(createTestConfig()),
    createTestConfig(),
  );
  const event = (geometryVersion: number) => ({
    eventId: randomUUID(),
    schemaVersion: '1.0.0',
    cameraExternalId: camera.externalId,
    streamSessionId: randomUUID(),
    capturedAt: new Date().toISOString(),
    frameDimensions: { width: 640, height: 480 },
    observations: [{ type: 'ZONE_ENTRY', trackId: 1, regionId: region.id, geometryVersion }],
    evidence: [],
  });
  assert.equal((await ingestion.ingestEvent(event(1))).status, 'SKIPPED_NO_CANDIDATE');
  assert.equal((await ingestion.ingestEvent(event(2))).status, 'PROCESSED');
  await cameras.setRegionActive(site.id, camera.id, region.id, {
    isActive: false,
    expectedConfigurationVersion: 3,
  });
  assert.equal((await ingestion.ingestEvent(event(2))).status, 'SKIPPED_NO_CANDIDATE');
  await cameras.setRegionActive(site.id, camera.id, region.id, {
    isActive: true,
    expectedConfigurationVersion: 4,
  });
  assert.equal((await ingestion.ingestEvent(event(2))).status, 'SKIPPED_NO_CANDIDATE');
  assert.equal((await ingestion.ingestEvent(event(4))).status, 'PROCESSED');
  await cameras.setStatus(site.id, camera.id, {
    status: CameraStatus.INACTIVE,
    expectedConfigurationVersion: 5,
  });
  assert.equal((await ingestion.ingestEvent(event(4))).status, 'SKIPPED_UNKNOWN_CAMERA');
  await cameras.setStatus(site.id, camera.id, {
    status: CameraStatus.ACTIVE,
    expectedConfigurationVersion: 6,
  });
  assert.equal((await ingestion.ingestEvent(event(4))).status, 'SKIPPED_NO_CANDIDATE');
  assert.equal((await ingestion.ingestEvent(event(6))).status, 'PROCESSED');
});

test('snapshot remains consistent when a writer commits between its camera and region reads', async () => {
  const { cameras, site, camera, zone } = await seed();
  const region = await cameras.createRegion(site.id, camera.id, {
    zoneId: zone.id,
    polygon: triangle,
    expectedConfigurationVersion: 1,
  });
  let writerCommitted = false;
  const subscriber: EntitySubscriberInterface<CameraEntity> = {
    listenTo: () => CameraEntity,
    async afterLoad(loaded) {
      if (loaded.id !== camera.id || writerCommitted) return;
      writerCommitted = true;
      // Await a real concurrent transaction after the first snapshot SELECT.
      await cameras.updatePolygon(site.id, camera.id, region.id, {
        polygon: {
          coordinates: [
            [0, 0],
            [1, 0],
            [0.5, 1],
          ],
        },
        expectedConfigurationVersion: 2,
      });
    },
  };
  dataSource.subscribers.push(subscriber);
  try {
    const snapshot = await cameras.buildConfiguration(site.id, camera.id);
    assert.equal(writerCommitted, true);
    assert.equal(snapshot.configurationVersion, 2);
    assert.equal(snapshot.regions[0]?.geometryVersion, 1);
    assert.deepEqual(snapshot.regions[0]?.polygon, triangle);
  } finally {
    dataSource.subscribers.splice(dataSource.subscribers.indexOf(subscriber), 1);
  }
  assert.equal((await cameras.get(site.id, camera.id)).configurationVersion, 3);
  assert.equal((await cameras.getRegion(site.id, camera.id, region.id)).version, 2);
});

test('the 65th active region is refused without locking the Zone or advancing the camera version', async () => {
  const { zones, cameras, site, camera, zone } = await seed();
  await dataSource.getRepository(CameraObservationRegionEntity).insert(
    Array.from({ length: 64 }, () => ({
      id: randomUUID(),
      cameraId: camera.id,
      zoneId: zone.id,
      polygon: triangle,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
    })),
  );
  await assert.rejects(
    cameras.createRegion(site.id, camera.id, {
      zoneId: zone.id,
      polygon: triangle,
      expectedConfigurationVersion: 1,
    }),
    isConflict,
  );
  assert.equal((await cameras.get(site.id, camera.id)).configurationVersion, 1);
  assert.equal((await zones.get(site.id, zone.id)).configurationLocked, false);
});

test('two concurrent attempts at the 64th slot leave exactly 64 active regions', async () => {
  const { cameras, site, camera, zone } = await seed();
  await dataSource.getRepository(CameraObservationRegionEntity).insert(
    Array.from({ length: 63 }, () => ({
      id: randomUUID(),
      cameraId: camera.id,
      zoneId: zone.id,
      polygon: triangle,
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
    })),
  );
  const command = {
    zoneId: zone.id,
    polygon: triangle,
    expectedConfigurationVersion: 1,
  };
  const results = await Promise.allSettled([
    cameras.createRegion(site.id, camera.id, command),
    cameras.createRegion(site.id, camera.id, command),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && isConflict(rejected.reason));
  assert.equal(
    await dataSource.getRepository(CameraObservationRegionEntity).countBy({
      cameraId: camera.id,
      isActive: true,
    }),
    64,
  );
  assert.equal((await cameras.get(site.id, camera.id)).configurationVersion, 2);
});

test('version exhaustion rolls back the attempted region update', async () => {
  const { cameras, site, camera, zone } = await seed();
  const region = await cameras.createRegion(site.id, camera.id, {
    zoneId: zone.id,
    polygon: triangle,
    expectedConfigurationVersion: 1,
  });
  await dataSource.getRepository(CameraEntity).update(
    { id: camera.id },
    {
      configurationVersion: Number.MAX_SAFE_INTEGER,
    },
  );
  await assert.rejects(
    cameras.updatePolygon(site.id, camera.id, region.id, {
      polygon: {
        coordinates: [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
      },
      expectedConfigurationVersion: Number.MAX_SAFE_INTEGER,
    }),
    isConflict,
  );
  assert.equal((await cameras.getRegion(site.id, camera.id, region.id)).version, 1);
  assert.deepEqual((await cameras.getRegion(site.id, camera.id, region.id)).polygon, triangle);
});

test('failed first region creation rolls back both the insert and the Zone policy lock', async () => {
  const { cameras, zones, site, camera, zone } = await seed();
  await dataSource.getRepository(CameraEntity).update(
    { id: camera.id },
    {
      configurationVersion: Number.MAX_SAFE_INTEGER,
    },
  );
  await assert.rejects(
    cameras.createRegion(site.id, camera.id, {
      zoneId: zone.id,
      polygon: triangle,
      expectedConfigurationVersion: Number.MAX_SAFE_INTEGER,
    }),
    isConflict,
  );
  assert.equal((await cameras.listRegions(site.id, camera.id)).total, 0);
  assert.equal((await zones.get(site.id, zone.id)).configurationLocked, false);
  assert.equal(
    (await cameras.get(site.id, camera.id)).configurationVersion,
    Number.MAX_SAFE_INTEGER,
  );
});

test('Region integer overflow rolls back every active Region and the Camera status', async () => {
  const { cameras, site, camera, zone } = await seed();
  for (const revision of [1, 2])
    await cameras.createRegion(site.id, camera.id, {
      zoneId: zone.id,
      polygon: triangle,
      expectedConfigurationVersion: revision,
    });
  const { items } = await cameras.listRegions(site.id, camera.id);
  const last = items[1]!;
  await dataSource.getRepository(CameraObservationRegionEntity).update(
    { id: last.id },
    {
      version: 2_147_483_647,
    },
  );
  await assert.rejects(
    cameras.setStatus(site.id, camera.id, {
      status: CameraStatus.INACTIVE,
      expectedConfigurationVersion: 3,
    }),
    isConflict,
  );
  const stored = await cameras.get(site.id, camera.id);
  assert.equal(stored.status, CameraStatus.ACTIVE);
  assert.equal(stored.configurationVersion, 3);
  assert.equal((await cameras.getRegion(site.id, camera.id, items[0]!.id)).version, 1);
  assert.equal((await cameras.getRegion(site.id, camera.id, last.id)).version, 2_147_483_647);
});
