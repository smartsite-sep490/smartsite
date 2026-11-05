import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { WorkforceConfigurationService } from '../src/modules/workforce/directory/workforce-configuration.service.js';

for (const operation of ['prepare', 'link'] as const) {
  test(`Worker account ${operation} reauthenticates before target reads or writes`, async () => {
    const denied = new Error('Synthetic revoked Admin session');
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
      operation === 'prepare'
        ? [randomUUID(), { userId: randomUUID() }, context]
        : [randomUUID(), randomUUID(), { userId: randomUUID() }, context];
    await assert.rejects(
      Reflect.apply(
        operation === 'prepare' ? service.forAccount : service.linkAccount,
        service,
        args,
      ),
      (error) => error === denied,
    );
    assert.equal(resourceReads, 0);
  });
}

for (const operation of ['prepare', 'link'] as const) {
  test(`Worker account ${operation} forwards original bearer context`, async () => {
    const { WorkforceController } =
      await import('../src/modules/workforce/directory/workforce.controller.js');
    const actor = randomUUID(),
      site = randomUUID(),
      worker = randomUUID();
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
      return { id: worker };
    };
    const controller = new WorkforceController(
      { forAccount: invoke, linkAccount: invoke } as never,
      {} as never,
      {
        authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
          assert.equal(actualRequest, request);
          assert.equal(actualManager, manager);
          rechecks++;
        },
      } as never,
    );
    if (operation === 'prepare')
      await controller.forAccount(request as never, site, { userId: randomUUID() });
    else await controller.linkAccount(request as never, site, worker, { userId: randomUUID() });
    assert.equal(rechecks, 1);
  });
}
