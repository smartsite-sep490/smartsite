import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UsersService } from '../src/modules/users/users.service.js';

test('administrative account creation rechecks the original Admin before saving a new account', async () => {
  const denied = new Error('Synthetic revoked Admin');
  let writes = 0;
  const manager = {
    query: async () => [],
    getRepository: () => ({
      save: async () => {
        writes++;
        throw Error('Write before actor check');
      },
    }),
  };
  const db = {
    transaction: async (first: unknown, second: unknown) =>
      ((typeof first === 'function' ? first : second) as (manager: unknown) => Promise<unknown>)(
        manager,
      ),
  };
  const users = new UsersService(db as never, {} as never);
  await assert.rejects(
    Reflect.apply(users.createAdministrative, users, [
      {
        username: 'synthetic-admin',
        displayName: 'Synthetic Admin',
        temporaryPassword: 'Synthetic_Create_123',
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
      {
        actorUserId: randomUUID(),
        reauthorize: async () => {
          throw denied;
        },
      },
    ]),
    (error) => error === denied,
  );
  assert.equal(writes, 0);
});
