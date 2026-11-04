import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { SiteConfigurationService } from '../src/modules/sites/site-configuration.service.js';

test('Site creation reauthorizes the original command context before any write', async () => {
  const denied = new Error('Synthetic revoked actor');
  let writes = 0;
  const db = {
    getRepository: () => ({
      save: async () => {
        writes++;
        return {};
      },
    }),
    transaction: async (_isolation: string, work: (manager: unknown) => Promise<unknown>) =>
      work({
        query: async () => {
          throw Error('Reauthorization must happen first');
        },
      }),
  };
  const sites = new SiteConfigurationService(db as never);
  const context = {
    actorUserId: randomUUID(),
    reauthorize: async () => {
      throw denied;
    },
  };
  await assert.rejects(
    Reflect.apply(sites.create, sites, [{ code: 'SYNTHETIC', name: 'Synthetic Site' }, context]),
    (error) => error === denied,
  );
  assert.equal(writes, 0);
});
