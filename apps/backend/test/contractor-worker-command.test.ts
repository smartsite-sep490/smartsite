import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ContractorOperationsService } from '../src/modules/workforce/directory/contractor-operations.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';

test('Contractor Worker creation reauthenticates before authorization resources or writes', async () => {
  const denied = new Error('Synthetic revoked Representative session');
  let accessChecks = 0;
  const service = new ContractorOperationsService({
    transaction: async (first: unknown, second: unknown) =>
      ((typeof first === 'function' ? first : second) as (m: unknown) => Promise<unknown>)({
        query: async () => [],
      }),
  } as never);
  service.requireWorkerCreationAccess = async () => {
    accessChecks++;
    throw new Error('Resource check before auth');
  };
  const actor = {
    id: randomUUID(),
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: randomUUID() }],
  };
  await assert.rejects(
    Reflect.apply(service.createWorker, service, [
      actor,
      randomUUID(),
      {
        siteId: actor.roleAssignments[0]!.siteId,
        externalId: 'SYN-W1',
        displayName: 'Synthetic Worker',
      },
      {
        actorUserId: actor.id,
        reauthorize: async () => {
          throw denied;
        },
      },
    ]),
    (error) => error === denied,
  );
  assert.equal(accessChecks, 0);
});

for (const route of ['contractor', 'site'] as const) {
  test(`Worker creation ${route} endpoint forwards original bearer`, async () => {
    const { ContractorOperationsController } =
      await import('../src/modules/workforce/directory/contractor-operations.controller.js');
    const { WorkforceController } =
      await import('../src/modules/workforce/directory/workforce.controller.js');
    const site = randomUUID(),
      contractor = randomUUID();
    const request = {
        user: {
          id: randomUUID(),
          mustChangePassword: false,
          roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: site }],
        },
      },
      manager = {};
    let rechecks = 0;
    const services = {
      createWorker: async (
        actor: unknown,
        contractorId: string,
        _input: unknown,
        context: { actorUserId: string; reauthorize: (m: unknown) => Promise<void> },
      ) => {
        assert.equal(actor, request.user);
        assert.equal(contractorId, contractor);
        assert.equal(context.actorUserId, request.user.id);
        await context.reauthorize(manager);
        return { id: randomUUID() };
      },
    };
    const auth = {
      authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
        assert.equal(actualRequest, request);
        assert.equal(actualManager, manager);
        rechecks++;
      },
    };
    if (route === 'contractor')
      await new ContractorOperationsController(services as never, auth as never).createWorker(
        request as never,
        contractor,
        { siteId: site, externalId: 'SYN-W1', displayName: 'Synthetic Worker' },
      );
    else
      await new WorkforceController({} as never, services as never, auth as never).create(
        request as never,
        site,
        { contractorId: contractor, externalId: 'SYN-W1', displayName: 'Synthetic Worker' },
      );
    assert.equal(rechecks, 1);
  });
}
