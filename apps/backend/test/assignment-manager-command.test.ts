import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ContractorOperationsService } from '../src/modules/workforce/directory/contractor-operations.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';
for (const operation of ['decision', 'revoke'] as const) {
  test(`Assignment ${operation} reauthenticates before target access, including retry`, async () => {
    const denied = new Error('Synthetic revoked Manager bearer');
    let reads = 0;
    const manager = {
      query: async () => [],
      getRepository: () => {
        reads++;
        throw new Error('Target before auth');
      },
    };
    const service = new ContractorOperationsService({
      transaction: async (first: unknown, second: unknown) =>
        ((typeof first === 'function' ? first : second) as (m: unknown) => Promise<unknown>)(
          manager,
        ),
    } as never);
    const actor = {
        id: randomUUID(),
        mustChangePassword: false,
        roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: randomUUID() }],
      },
      context = {
        actorUserId: actor.id,
        reauthorize: async () => {
          throw denied;
        },
      };
    const input =
      operation === 'decision'
        ? { approve: true, expectedVersion: 1, reviewNote: 'Synthetic approval' }
        : { expectedVersion: 2, reviewNote: 'Synthetic revocation' };
    await assert.rejects(
      Reflect.apply(
        operation === 'decision' ? service.siteManagerDecision : service.revokeAssignment,
        service,
        [actor, randomUUID(), input, context],
      ),
      (error) => error === denied,
    );
    assert.equal(reads, 0);
  });
}

for (const operation of ['decision', 'revoke'] as const) {
  test(`Assignment Manager ${operation} endpoint forwards original bearer`, async () => {
    const { WorkerAssignmentController } =
      await import('../src/modules/workforce/directory/worker-assignment.controller.js');
    const request = { user: { id: randomUUID() } },
      manager = {};
    let rechecks = 0;
    const invoke = async (...args: unknown[]) => {
      assert.equal(args[0], request.user);
      const context = args.at(-1) as {
        actorUserId: string;
        reauthorize: (m: unknown) => Promise<void>;
      };
      assert.equal(context.actorUserId, request.user.id);
      await context.reauthorize(manager);
      return { id: randomUUID() };
    };
    const controller = new WorkerAssignmentController(
      { siteManagerDecision: invoke, revokeAssignment: invoke } as never,
      {
        authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
          assert.equal(actualRequest, request);
          assert.equal(actualManager, manager);
          rechecks++;
        },
      } as never,
    );
    if (operation === 'decision')
      await controller.siteManagerDecision(request as never, randomUUID(), {
        approve: true,
        expectedVersion: 1,
      });
    else
      await controller.revoke(request as never, randomUUID(), {
        expectedVersion: 2,
        reviewNote: 'Synthetic revocation',
      });
    assert.equal(rechecks, 1);
  });
}
