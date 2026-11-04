import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';

for (const operation of ['createRegion', 'updatePolygon', 'setRegionActive'] as const) {
  test(`Region ${operation} rechecks original actor even for unchanged geometry/status`, async () => {
    const denied = new Error('Synthetic revoked Manager');
    const siteId = randomUUID(),
      cameraId = randomUUID(),
      regionId = randomUUID();
    const polygon = {
      coordinates: [
        [0.1, 0.1],
        [0.9, 0.1],
        [0.5, 0.9],
      ],
    };
    const camera = { id: cameraId, siteId, configurationVersion: 1, status: 'ACTIVE' };
    const region = { id: regionId, cameraId, polygon, isActive: true };
    let writes = 0;
    const builder = { setLock: () => builder, where: () => builder, getOne: async () => camera };
    const repo = {
      findOneBy: async () => region,
      createQueryBuilder: () => builder,
      countBy: async () => 0,
      save: async () => {
        writes++;
        return region;
      },
    };
    const manager = {
      getRepository: () => repo,
      query: async () => {
        throw Error('Reauthorize before SQL');
      },
    };
    const db = {
      transaction: async (first: unknown, second: unknown) =>
        ((typeof first === 'function' ? first : second) as (manager: unknown) => Promise<unknown>)(
          manager,
        ),
    };
    const service = new CameraConfigurationService(
      db as never,
      {
        lockForRegion: async () => ({ id: randomUUID() }),
        markLinked: async () => undefined,
      } as never,
      {} as never,
    );
    const context = {
      actorUserId: randomUUID(),
      reauthorize: async () => {
        throw denied;
      },
    };
    const input =
      operation === 'createRegion'
        ? { zoneId: randomUUID(), polygon, expectedConfigurationVersion: 1 }
        : operation === 'updatePolygon'
          ? { polygon, expectedConfigurationVersion: 1 }
          : { isActive: true, expectedConfigurationVersion: 1 };
    const args =
      operation === 'createRegion'
        ? [siteId, cameraId, input, context]
        : [siteId, cameraId, regionId, input, context];
    await assert.rejects(
      Reflect.apply(service[operation], service, args),
      (error) => error === denied,
    );
    assert.equal(writes, 0);
  });
}
