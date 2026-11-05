import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { WorkforceConfigurationService } from '../src/modules/workforce/directory/workforce-configuration.service.js';

for (const operation of ['create', 'rename'] as const) {
  test(`Site Contractor ${operation} reauthenticates before resources`, async () => {
    const denied = new Error('Synthetic revoked Manager session');
    let resourceReads = 0;
    const manager = {
      query: async () => [],
      getRepository: () => {
        resourceReads++;
        throw new Error('Target accessed before authentication');
      },
    };
    const service = new WorkforceConfigurationService({
      transaction: async (first: unknown, second: unknown) =>
        ((typeof first === 'function' ? first : second) as (m: unknown) => Promise<unknown>)(
          manager,
        ),
    } as never);
    const context = {
      actorUserId: randomUUID(),
      reauthorize: async () => {
        throw denied;
      },
    };
    const args =
      operation === 'create'
        ? [randomUUID(), { name: 'Synthetic Contractor' }, context]
        : [
            randomUUID(),
            randomUUID(),
            { name: 'Renamed', expectedName: 'Synthetic Contractor' },
            context,
          ];
    await assert.rejects(
      Reflect.apply(
        operation === 'create' ? service.createContractor : service.renameContractor,
        service,
        args,
      ),
      (error) => error === denied,
    );
    assert.equal(resourceReads, 0);
  });
}

for (const operation of ['create', 'rename'] as const) {
  test(`Site Contractor ${operation} forwards original HTTP authentication`, async () => {
    const { ContractorsController } =
      await import('../src/modules/workforce/directory/contractors.controller.js');
    const actor = randomUUID(),
      site = randomUUID(),
      contractor = randomUUID();
    const request = { user: { id: actor } },
      manager = {};
    let rechecks = 0;
    const invoke = async (...args: unknown[]) => {
      assert.equal(args[0], site);
      const context = args.at(-1) as {
        actorUserId: string;
        reauthorize: (m: unknown) => Promise<void>;
      };
      assert.equal(context.actorUserId, actor);
      await context.reauthorize(manager);
      return { id: contractor };
    };
    const controller = new ContractorsController(
      { createContractor: invoke, renameContractor: invoke } as never,
      {
        authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
          assert.equal(actualRequest, request);
          assert.equal(actualManager, manager);
          rechecks++;
        },
      } as never,
    );
    if (operation === 'create')
      await controller.create(request as never, site, { name: 'Synthetic Contractor' });
    else
      await controller.rename(request as never, site, contractor, {
        name: 'Renamed',
        expectedName: 'Synthetic Contractor',
      });
    assert.equal(rechecks, 1);
  });
}
