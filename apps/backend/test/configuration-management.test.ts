import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource, type EntityManager } from 'typeorm';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { SiteConfigurationService } from '../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../src/modules/zones/zone-configuration.service.js';
import { CameraEntity } from '../src/database/entities/camera.entity.js';
import { CameraObservationRegionEntity } from '../src/database/entities/camera-observation-region.entity.js';
import { CameraStatus, ZoneRestrictionPolicy, ZoneType } from '../src/database/entities/enums.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';

test('internal commands reject extra fields and unsupported PPE before database access', async () => {
  const db = undefined as unknown as DataSource;
  const sites = new SiteConfigurationService(db);
  const zones = new ZoneConfigurationService(db, sites);
  const cameras = new CameraConfigurationService(db, zones, sites);
  const invalid = (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED';
  await assert.rejects(
    sites.create({ code: 'S', name: 'Site', id: randomUUID() } as never),
    invalid,
  );
  await assert.rejects(sites.create({ code: 'S', name: '  ' }), invalid);
  await assert.rejects(sites.create({ code: 'S', name: 'Broken-\ud800' }), invalid);
  await assert.rejects(sites.create({ code: 'Broken-\udfff', name: 'Site' }), invalid);
  await assert.rejects(
    zones.create(randomUUID(), {
      code: 'Z',
      name: 'Zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['GLOVES'],
    }),
    invalid,
  );
  await assert.rejects(
    zones.create(randomUUID(), {
      code: 'Z',
      name: 'Zone',
      type: 'UNKNOWN' as ZoneType,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['HARD_HAT', 'HARD_HAT'],
    }),
    invalid,
  );
  await assert.rejects(
    cameras.create(randomUUID(), { code: 'C', name: 'Camera', externalId: 'CAM-\ud800' }),
    invalid,
  );
  for (const polygon of [
    {
      coordinates: [
        [0, 0],
        [1, 1],
        [0, 1],
        [1, 0],
      ],
    },
    {
      coordinates: [
        [0, 0],
        [2, 0],
        [0, 1],
      ],
    },
    {
      coordinates: [
        [0, 0],
        [1, 0],
        [0, 0],
      ],
    },
    {
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    },
  ])
    await assert.rejects(
      cameras.createRegion(randomUUID(), randomUUID(), {
        zoneId: randomUUID(),
        polygon,
        expectedConfigurationVersion: 1,
      }),
      invalid,
    );
});

test('reactivating a region refuses to exceed 64 active regions', async () => {
  const siteId = randomUUID();
  const cameraId = randomUUID();
  const regionId = randomUUID();
  const camera = { id: cameraId, siteId, status: CameraStatus.ACTIVE, configurationVersion: 2 };
  const region = { id: regionId, cameraId, isActive: false, version: 2 };
  const cameraRepository = {
    createQueryBuilder: () => ({
      setLock() {
        return this;
      },
      where() {
        return this;
      },
      async getOne() {
        return camera;
      },
    }),
  };
  const regionRepository = {
    async findOneBy() {
      return region;
    },
    async countBy() {
      return 64;
    },
    async save() {
      return region;
    },
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === CameraEntity
        ? cameraRepository
        : entity === CameraObservationRegionEntity
          ? regionRepository
          : undefined,
  };
  const db = {
    transaction: async (run: (value: typeof manager) => Promise<unknown>) => await run(manager),
  } as unknown as DataSource;
  const service = new CameraConfigurationService(db, undefined as never, undefined as never);
  await assert.rejects(
    service.setRegionActive(siteId, cameraId, regionId, {
      expectedConfigurationVersion: 2,
      isActive: true,
    }),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'CONFLICT',
  );
});

test('camera status survives a reload and both lifecycle transitions advance the revision', async () => {
  const stored = {
    id: randomUUID(),
    siteId: randomUUID(),
    externalId: 'CAM-LIFECYCLE',
    status: CameraStatus.ACTIVE,
    configurationVersion: 1,
  };
  const cameraRepository = {
    createQueryBuilder: () => ({
      setLock() {
        return this;
      },
      where() {
        return this;
      },
      async getOne() {
        return { ...stored };
      },
    }),
    async findOneBy() {
      return { ...stored };
    },
    async update(_where: unknown, values: Partial<typeof stored>) {
      Object.assign(stored, values);
    },
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === CameraEntity
        ? cameraRepository
        : {
            async find() {
              return [];
            },
          },
  } as unknown as EntityManager;
  const db = {
    getRepository: manager.getRepository.bind(manager),
    async transaction(
      isolationOrRun: string | ((manager: EntityManager) => Promise<unknown>),
      run?: (manager: EntityManager) => Promise<unknown>,
    ) {
      return await (typeof isolationOrRun === 'function' ? isolationOrRun : run!)(manager);
    },
  } as unknown as DataSource;
  const service = new CameraConfigurationService(db, undefined as never, undefined as never);
  await service.setStatus(stored.siteId, stored.id, {
    status: CameraStatus.INACTIVE,
    expectedConfigurationVersion: 1,
  });
  assert.equal((await service.get(stored.siteId, stored.id)).status, CameraStatus.INACTIVE);
  assert.equal(stored.configurationVersion, 2);
  await assert.rejects(
    service.buildConfiguration(stored.siteId, stored.id),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'CONFLICT',
  );
  await service.setStatus(stored.siteId, stored.id, {
    status: CameraStatus.ACTIVE,
    expectedConfigurationVersion: 2,
  });
  assert.equal((await service.get(stored.siteId, stored.id)).status, CameraStatus.ACTIVE);
  assert.equal(
    (await service.buildConfiguration(stored.siteId, stored.id)).configurationVersion,
    3,
  );
});

test('TypeORM can generate a camera insert that uses the database revision default', async () => {
  class MetadataDataSource extends DataSource {
    async prepareMetadata() {
      await this.buildMetadatas();
    }
  }
  const source = new MetadataDataSource(
    buildTypeOrmOptions({
      DATABASE_URL: 'postgresql://smartsite_test:test_only@127.0.0.1:5433/smartsite_test',
    }),
  );
  // Metadata/query generation only: this test never initializes a database connection.
  await source.prepareMetadata();
  const query = source.createQueryBuilder().insert().into(CameraEntity).values({
    id: randomUUID(),
    siteId: randomUUID(),
    code: 'CAM',
    name: 'Camera',
    externalId: 'CAM',
  });
  assert.doesNotThrow(() => query.getQueryAndParameters());
});
