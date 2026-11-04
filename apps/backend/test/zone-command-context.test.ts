import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ZoneConfigurationService } from '../src/modules/zones/zone-configuration.service.js';

for (const operation of ['rename', 'updatePolicy'] as const) {
  test(`Zone ${operation} must reauthorize even a no-op request`, async () => {
    const denied = new Error('Synthetic revoked Site Manager');
    const siteId = randomUUID(),
      zoneId = randomUUID();
    const zone = {
      id: zoneId,
      siteId,
      name: 'Synthetic Zone',
      type: 'STANDARD',
      restrictionPolicy: 'NONE',
      requiredPpe: [],
      configurationLocked: false,
    };
    const builder = { setLock: () => builder, where: () => builder, getOne: async () => zone };
    const manager = {
      getRepository: () => ({ findOneBy: async () => zone, createQueryBuilder: () => builder }),
      query: async () => {
        throw Error('Reauthorize before SQL authorization');
      },
    };
    const db = {
      ...manager,
      transaction: async (first: unknown, second: unknown) =>
        ((typeof first === 'function' ? first : second) as (manager: unknown) => Promise<unknown>)(
          manager,
        ),
    };
    const zones = new ZoneConfigurationService(
      db as never,
      { get: async () => ({ id: siteId }) } as never,
    );
    const input =
      operation === 'rename'
        ? { name: zone.name }
        : { type: zone.type, restrictionPolicy: zone.restrictionPolicy, requiredPpe: [] };
    const context = {
      actorUserId: randomUUID(),
      reauthorize: async () => {
        throw denied;
      },
    };
    await assert.rejects(
      Reflect.apply(zones[operation], zones, [siteId, zoneId, input, context]),
      (error) => error === denied,
    );
  });
}
