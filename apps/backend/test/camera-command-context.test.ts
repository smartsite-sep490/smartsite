import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
for (const operation of ['create', 'rename', 'setStatus'] as const) {
  test(`Camera ${operation} rechecks original actor before any configuration write`, async () => {
    const denied = new Error('Synthetic revoked Manager');
    const siteId = randomUUID(),
      cameraId = randomUUID();
    let writes = 0;
    const camera = {
      id: cameraId,
      siteId,
      name: 'Synthetic Camera',
      status: 'ACTIVE',
      configurationVersion: 1,
    };
    const builder = { setLock: () => builder, where: () => builder, getOne: async () => camera };
    const repo = {
      findOneBy: async () => camera,
      save: async () => {
        writes++;
        return camera;
      },
      createQueryBuilder: () => builder,
    };
    const manager = {
      getRepository: () => repo,
      query: async () => {
        throw Error('Reauthorize before role SQL');
      },
    };
    const db = {
      ...manager,
      transaction: async (first: unknown, second: unknown) =>
        ((typeof first === 'function' ? first : second) as (manager: unknown) => Promise<unknown>)(
          manager,
        ),
    };
    const cameras = new CameraConfigurationService(
      db as never,
      {} as never,
      { get: async () => ({ id: siteId }) } as never,
    );
    const context = {
      actorUserId: randomUUID(),
      reauthorize: async () => {
        throw denied;
      },
    };
    const input =
      operation === 'create'
        ? { code: 'SYNTHETIC', externalId: 'synthetic-camera', name: camera.name }
        : operation === 'rename'
          ? { name: camera.name }
          : { status: 'ACTIVE', expectedConfigurationVersion: 1 };
    const args =
      operation === 'create' ? [siteId, input, context] : [siteId, cameraId, input, context];
    await assert.rejects(
      Reflect.apply(cameras[operation], cameras, args),
      (error) => error === denied,
    );
    assert.equal(writes, 0);
  });
}
