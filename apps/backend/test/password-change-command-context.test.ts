import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { hashPassword } from '../src/modules/auth/password.js';

test('password change rechecks the original session before updating the target account', async () => {
  const denied = new Error('Synthetic revoked self session');
  const user = {
    id: randomUUID(),
    isActive: true,
    passwordHash: await hashPassword('Synthetic_Current_123'),
  };
  let writes = 0;
  const builder = { setLock: () => builder, where: () => builder, getOne: async () => user };
  const repo = {
    findOneBy: async () => user,
    createQueryBuilder: () => builder,
    update: async () => {
      writes++;
      throw Error('Update before original session recheck');
    },
  };
  const manager = { query: async () => [], getRepository: () => repo };
  const db = {
    getRepository: () => repo,
    transaction: async (first: unknown, second: unknown) =>
      ((typeof first === 'function' ? first : second) as (manager: unknown) => Promise<unknown>)(
        manager,
      ),
  };
  const auth = new AuthService(db as never, {} as never);
  await assert.rejects(
    Reflect.apply(auth.changePassword, auth, [
      user.id,
      'Synthetic_Current_123',
      'Synthetic_New_123',
      {
        actorUserId: user.id,
        reauthorize: async () => {
          throw denied;
        },
      },
    ]),
    (error) => error === denied,
  );
  assert.equal(writes, 0);
});
