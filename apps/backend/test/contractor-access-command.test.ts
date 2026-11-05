import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UserRole } from '../src/database/entities/user.entity.js';
import { ContractorOperationsService } from '../src/modules/workforce/directory/contractor-operations.service.js';

for (const operation of ['participation', 'grant'] as const) {
  test(`Contractor ${operation} reauthenticates before resources`, async () => {
    const denied = new Error('Synthetic revoked actor session');
    let resourceReads = 0;
    const manager = {
      query: async () => [],
      getRepository: () => {
        resourceReads++;
        throw new Error('Resource before auth');
      },
    };
    const service = new ContractorOperationsService({
      transaction: async (first: unknown, second: unknown) =>
        ((typeof first === 'function' ? first : second) as (m: unknown) => Promise<unknown>)(
          manager,
        ),
    } as never);
    const site = randomUUID(),
      actor = {
        id: randomUUID(),
        mustChangePassword: false,
        roleAssignments: [
          {
            role: operation === 'participation' ? UserRole.SITE_MANAGER : UserRole.ADMIN,
            siteId: operation === 'participation' ? site : null,
          },
        ],
      };
    const context = {
      actorUserId: actor.id,
      reauthorize: async () => {
        throw denied;
      },
    };
    const input =
      operation === 'participation'
        ? { siteId: site, validFrom: '2020-01-01T00:00:00Z', validUntil: null }
        : { userId: randomUUID() };
    await assert.rejects(
      Reflect.apply(
        operation === 'participation' ? service.createParticipation : service.grantRepresentative,
        service,
        [actor, randomUUID(), input, context],
      ),
      (error) => error === denied,
    );
    assert.equal(resourceReads, 0);
  });
}

for (const operation of ['participation', 'grant'] as const) {
  test(`Contractor ${operation} forwards original bearer and actor`, async () => {
    const { ContractorOperationsController } =
      await import('../src/modules/workforce/directory/contractor-operations.controller.js');
    const actor = randomUUID(),
      contractor = randomUUID(),
      request = { user: { id: actor } },
      manager = {};
    let rechecks = 0;
    const invoke = async (...args: unknown[]) => {
      assert.equal(args[0], request.user);
      assert.equal(args[1], contractor);
      const context = args[3] as {
        actorUserId: string;
        reauthorize: (m: unknown) => Promise<void>;
      };
      assert.equal(context.actorUserId, actor);
      await context.reauthorize(manager);
      return { id: randomUUID() };
    };
    const controller = new ContractorOperationsController(
      { createParticipation: invoke, grantRepresentative: invoke } as never,
      {
        authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
          assert.equal(actualRequest, request);
          assert.equal(actualManager, manager);
          rechecks++;
        },
      } as never,
    );
    if (operation === 'participation')
      await controller.createParticipation(request as never, contractor, {
        siteId: randomUUID(),
        validFrom: '2020-01-01T00:00:00Z',
        validUntil: null,
      });
    else
      await controller.grantRepresentative(request as never, contractor, { userId: randomUUID() });
    assert.equal(rechecks, 1);
  });
}
