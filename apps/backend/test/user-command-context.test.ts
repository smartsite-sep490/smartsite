import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UsersService } from '../src/modules/users/users.service.js';

for (const operation of [
  'setStatus',
  'replaceRoleAssignments',
  'revokeSiteManager',
  'resetPassword',
] as const) {
  test(`User ${operation} rejects a revoked original Admin before target mutation`, async () => {
    const actorId = randomUUID(),
      userId = randomUUID(),
      siteId = randomUUID();
    const denied = new Error('Synthetic revoked Admin');
    let writes = 0;
    const write = async () => {
      writes++;
      throw new Error('Target write before actor recheck');
    };
    const user = {
      id: userId,
      username: 'synthetic',
      displayName: 'Synthetic',
      isActive: true,
      mustChangePassword: false,
    };
    const builder = { setLock: () => builder, where: () => builder, getOne: async () => user };
    const repo = {
      createQueryBuilder: () => builder,
      findOne: async () => user,
      findBy: async () => [],
      delete: write,
      insert: write,
      save: write,
      update: write,
    };
    const manager = { query: async () => [], getRepository: () => repo };
    const db = {
      transaction: async (first: unknown, second: unknown) =>
        ((typeof first === 'function' ? first : second) as (manager: unknown) => Promise<unknown>)(
          manager,
        ),
    };
    const service = new UsersService(db as never, {} as never);
    const context = {
      actorUserId: actorId,
      reauthorize: async () => {
        throw denied;
      },
    };
    const args =
      operation === 'setStatus'
        ? [actorId, userId, { isActive: true }, context]
        : operation === 'replaceRoleAssignments'
          ? [userId, { roleAssignments: [{ role: 'ADMIN', siteId: null }] }, context]
          : operation === 'revokeSiteManager'
            ? [userId, siteId, context]
            : [userId, { temporaryPassword: 'Synthetic_Reset_123' }, context];
    await assert.rejects(
      Reflect.apply(service[operation], service, args),
      (error) => error === denied,
    );
    assert.equal(writes, 0);
  });
}
