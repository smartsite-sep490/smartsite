import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { WorkforceConfigurationService } from '../src/modules/workforce/directory/workforce-configuration.service.js';
import { ContractorsController } from '../src/modules/workforce/directory/contractors.controller.js';
import type { MainConfigurationCommandContext } from '../src/common/configuration/main-configuration-authority.js';

test('assigning an existing representative reauthenticates before grant or assignment writes', async () => {
  const denied = new Error('Synthetic revoked Site Manager');
  let mutations = 0;
  const manager = { query: async () => [] };
  const source = {
    transaction: async (first: unknown, second: unknown) =>
      ((typeof first === 'function' ? first : second) as (m: unknown) => Promise<unknown>)(manager),
  };
  const service = new WorkforceConfigurationService(source as never);
  service.assignRepresentativeInTransaction = async () => {
    mutations++;
    return {} as never;
  };
  await assert.rejects(
    Reflect.apply(service.assignRepresentative, service, [
      randomUUID(),
      randomUUID(),
      { userId: randomUUID() },
      {
        actorUserId: randomUUID(),
        reauthorize: async () => {
          throw denied;
        },
      },
    ]),
    (error) => error === denied,
  );
  assert.equal(mutations, 0);
});

test('assignment forwards original HTTP authentication context', async () => {
  const actor = randomUUID(),
    site = randomUUID(),
    contractor = randomUUID();
  const request = { user: { id: actor } },
    manager = {};
  let rechecks = 0;
  const controller = new ContractorsController(
    {
      assignRepresentative: async (
        actualSite: string,
        actualContractor: string,
        _input: unknown,
        context: MainConfigurationCommandContext,
      ) => {
        assert.equal(actualSite, site);
        assert.equal(actualContractor, contractor);
        assert.equal(context.actorUserId, actor);
        await context.reauthorize!(manager as never);
        return { id: randomUUID() };
      },
    } as never,
    {
      authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
        assert.equal(actualRequest, request);
        assert.equal(actualManager, manager);
        rechecks++;
      },
    } as never,
  );
  await controller.assignRepresentative(request as never, site, contractor, {
    userId: randomUUID(),
  });
  assert.equal(rechecks, 1);
});
