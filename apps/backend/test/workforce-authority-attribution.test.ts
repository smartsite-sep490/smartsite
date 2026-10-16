import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.service.js';
import { ContractorsController } from '../src/modules/workforce/directory/contractors.controller.js';
import { WorkforceController } from '../src/modules/workforce/directory/workforce.controller.js';
import type { WorkforceConfigurationService } from '../src/modules/workforce/workforce-configuration.service.js';
import type { MainWorkforceCreateService } from '../src/modules/workforce/main-workforce-create.service.js';
import type { MainWorkerRosterService } from '../src/modules/workforce/main-worker-roster.service.js';
import type { MainRepresentativeCommandService } from '../src/modules/workforce/main-representative-command.service.js';
import type { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import type { MainConfigurationCommandContext } from '../src/common/configuration/main-configuration-authority.js';
import type { EntityManager } from 'typeorm';

const userId = '00000000-0000-4000-8000-000000000001';
const siteId = '00000000-0000-4000-8000-000000000002';
const workerId = '00000000-0000-4000-8000-000000000003';
const request = { user: { id: userId } } as AuthenticatedRequest;

// Exercise actual HTTP controller methods: forgetting this argument silently
// attributes an authenticated write to the internal SERVICE default.
for (const operation of ['forAccount', 'linkAccount', 'create'] as const) {
  test(`Workforce HTTP ${operation} supplies the authenticated USER to audit`, async () => {
    let received: unknown[] | undefined;
    const workforce = {
      [operation]: async (...args: unknown[]) => {
        received = args;
        return { id: workerId, siteId, code: 'Synthetic', name: 'Synthetic' };
      },
    } as unknown as MainWorkerRosterService;
    const manager = {} as EntityManager;
    let reauthorized = false;
    const guard = {
      authenticateRequest: async (received: AuthenticatedRequest, transaction: EntityManager) => {
        assert.equal(received, request);
        assert.equal(transaction, manager);
        reauthorized = true;
      },
    } as unknown as UserAuthGuard;
    const controller = new WorkforceController(
      {} as WorkforceConfigurationService,
      workforce,
      guard,
    );
    if (operation === 'forAccount') await controller.forAccount(request, siteId, { userId });
    else if (operation === 'linkAccount')
      await controller.linkAccount(request, siteId, workerId, { userId });
    else if (operation === 'create')
      await controller.create(request, siteId, {
        externalId: 'Synthetic',
        displayName: 'Synthetic',
      });
    assert.ok(received);
    const context = received.at(-1) as MainConfigurationCommandContext;
    assert.equal(context.actorUserId, userId);
    await context.reauthorize?.(manager);
    assert.equal(reauthorized, true);
  });
}

test('Site Contractor HTTP creation passes the server actor and original request reauthorization', async () => {
  let context: MainConfigurationCommandContext | undefined;
  const creation = {
    createSiteContractor: async (
      _site: string,
      _input: unknown,
      value: MainConfigurationCommandContext,
    ) => {
      context = value;
      return { id: workerId, code: 'Synthetic', name: 'Synthetic' };
    },
  } as unknown as MainWorkforceCreateService;
  const manager = {} as EntityManager;
  const guard = {
    authenticateRequest: async (received: AuthenticatedRequest, transaction: EntityManager) => {
      assert.equal(received, request);
      assert.equal(transaction, manager);
    },
  } as unknown as UserAuthGuard;
  const controller = new ContractorsController(
    {} as WorkforceConfigurationService,
    creation,
    guard,
    {} as MainRepresentativeCommandService,
  );
  await controller.create(request, siteId, { code: 'Synthetic', name: 'Synthetic' });
  assert.equal(context?.actorUserId, userId);
  assert.equal(typeof context?.reauthorize, 'function');
  await context?.reauthorize?.(manager);
});
