import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { CameraObservationRegionEntity } from '../src/database/entities/camera-observation-region.entity.js';
import { CameraEntity } from '../src/database/entities/camera.entity.js';
import { ZoneRestrictionPolicy, ZoneType } from '../src/database/entities/enums.js';
import { SiteEntity } from '../src/database/entities/site.entity.js';
import { ZoneEntity } from '../src/database/entities/zone.entity.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';

function matches(row: object, where: object): boolean {
  return Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
}

function repo<T extends object>(rows: T[]): Pick<Repository<T>, 'findOneBy' | 'create' | 'insert'> {
  return {
    findOneBy: (async (where: object) => rows.find((row) => matches(row, where)) ?? null) as Repository<T>['findOneBy'],
    create: ((value: T) => value) as Repository<T>['create'],
    insert: (async (value: T) => {
      rows.push(value);
      return { identifiers: [], generatedMaps: [], raw: [] };
    }) as Repository<T>['insert'],
  };
}

function dataSource(): DataSource {
  const sites: SiteEntity[] = [];
  const zones: ZoneEntity[] = [];
  const cameras: CameraEntity[] = [];
  const regions: CameraObservationRegionEntity[] = [];
  const manager = {
    getRepository(entity: unknown) {
      if (entity === SiteEntity) return repo(sites);
      if (entity === ZoneEntity) return repo(zones);
      if (entity === CameraEntity) return repo(cameras);
      if (entity === CameraObservationRegionEntity) return repo(regions);
      throw new Error('unexpected repository');
    },
  } as unknown as EntityManager;
  return {
    transaction: (fn: (manager: EntityManager) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;
}

test('catalog creates a site once and returns the same row for the same code', async () => {
  const service = new CatalogService(dataSource());
  const first = await service.createSite({ code: 'PPE-DEMO', name: 'PPE demo site' });
  const second = await service.createSite({ code: 'PPE-DEMO', name: 'Other name' });
  assert.equal(second.id, first.id);
  assert.equal(second.name, 'PPE demo site');
});

test('catalog rejects a region when the camera and zone are on different sites', async () => {
  const service = new CatalogService(dataSource());
  const firstSite = await service.createSite({ code: 'A', name: 'A' });
  const secondSite = await service.createSite({ code: 'B', name: 'B' });
  const zone = await service.createZone({
    siteId: firstSite.id,
    code: 'Z',
    name: 'Zone',
    type: ZoneType.RESTRICTED,
    restrictionPolicy: ZoneRestrictionPolicy.PROHIBITED_FOR_ALL,
  });
  const camera = await service.createCamera({
    siteId: secondSite.id,
    externalId: 'ppe-demo',
    code: 'CAM',
    name: 'Camera',
  });
  await assert.rejects(
    () =>
      service.createRegion({
        cameraId: camera.id,
        zoneId: zone.id,
        coordinates: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      }),
    BadRequestException,
  );
});

test('catalog rejects a polygon point outside the normalized range', async () => {
  const service = new CatalogService(dataSource());
  await assert.rejects(
    () =>
      service.createRegion({
        cameraId: '33333333-3333-4333-8333-333333333333',
        zoneId: '22222222-2222-4222-8222-222222222222',
        coordinates: [
          [0, 0],
          [1.2, 0],
          [1, 1],
        ],
      }),
    BadRequestException,
  );
});
