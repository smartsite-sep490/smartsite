import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ContractorOperationsService } from '../src/modules/workforce/directory/contractor-operations.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';
for (const operation of ['request', 'review'] as const) {
  test(`Assignment ${operation} reauthenticates before reading target resources`, async () => {
    const denied = new Error('Synthetic revoked bearer');
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
    const actor = {
      id: randomUUID(),
      mustChangePassword: false,
      roleAssignments: [
        {
          role:
            operation === 'request' ? UserRole.CONTRACTOR_REPRESENTATIVE : UserRole.SAFETY_OFFICER,
          siteId: randomUUID(),
        },
      ],
    };
    const context = {
      actorUserId: actor.id,
      reauthorize: async () => {
        throw denied;
      },
    };
    const args =
      operation === 'request'
        ? [
            actor,
            randomUUID(),
            {
              siteId: actor.roleAssignments[0]!.siteId,
              zoneIds: [randomUUID()],
              validFrom: '2041-01-01T00:00:00Z',
              validUntil: '2042-01-01T00:00:00Z',
            },
            context,
          ]
        : [actor, randomUUID(), context];
    await assert.rejects(
      Reflect.apply(
        operation === 'request' ? service.requestAssignment : service.safetyReview,
        service,
        args,
      ),
      (error) => error === denied,
    );
    assert.equal(resourceReads, 0);
  });
}

for (const operation of ['request', 'review'] as const) {
  test(`Assignment ${operation} controller forwards original bearer`, async () => {
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
      { requestAssignment: invoke, safetyReview: invoke } as never,
      {
        authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
          assert.equal(actualRequest, request);
          assert.equal(actualManager, manager);
          rechecks++;
        },
      } as never,
    );
    if (operation === 'request')
      await controller.requestAssignment(request as never, randomUUID(), {
        siteId: randomUUID(),
        zoneIds: [randomUUID()],
        validFrom: '2041-01-01T00:00:00Z',
        validUntil: '2042-01-01T00:00:00Z',
      });
    else await controller.safetyReview(request as never, randomUUID());
    assert.equal(rechecks, 1);
  });
}
