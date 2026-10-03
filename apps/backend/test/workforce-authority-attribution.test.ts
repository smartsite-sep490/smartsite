import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.service.js';
import { ContractorsController } from '../src/modules/workforce/contractors.controller.js';
import { WorkforceController } from '../src/modules/workforce/workforce.controller.js';
import type { WorkforceConfigurationService } from '../src/modules/workforce/workforce-configuration.service.js';

const userId = '00000000-0000-4000-8000-000000000001';
const siteId = '00000000-0000-4000-8000-000000000002';
const workerId = '00000000-0000-4000-8000-000000000003';
const request = { user: { id: userId } } as AuthenticatedRequest;

// Exercise actual HTTP controller methods: forgetting this argument silently
// attributes an authenticated write to the internal SERVICE default.
for (const operation of ['forAccount', 'linkAccount', 'create', 'createContractor'] as const) {
  test(`Workforce HTTP ${operation} supplies the authenticated USER to audit`, async () => {
    let received: unknown[] | undefined;
    const workforce = {
      [operation]: async (...args: unknown[]) => {
        received = args;
        return { id: workerId, siteId, code: 'Synthetic', name: 'Synthetic' };
      },
    } as unknown as WorkforceConfigurationService;
    const controller = new WorkforceController(workforce);
    if (operation === 'forAccount') await controller.forAccount(request, siteId, { userId });
    else if (operation === 'linkAccount')
      await controller.linkAccount(request, siteId, workerId, { userId });
    else if (operation === 'create')
      await controller.create(request, siteId, {
        externalId: 'Synthetic',
        displayName: 'Synthetic',
      });
    else
      await new ContractorsController(workforce).create(request, siteId, {
        code: 'Synthetic',
        name: 'Synthetic',
      });
    assert.ok(received);
    assert.deepEqual(received.at(-1), { kind: 'USER', userId });
  });
}
