import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  SiteRepresentativesController,
  SiteRepresentativesService,
} from '../src/modules/users/site-representatives.controller.js';
import type { MainConfigurationCommandContext } from '../src/common/configuration/main-configuration-authority.js';

for (const operation of ['create', 'createWithContractor', 'rename'] as const) {
  test(`representative ${operation} rejects a revoked actor before any write`, async () => {
    const site = randomUUID(),
      userId = randomUUID(),
      contractorId = randomUUID();
    const denied = new Error('Synthetic session revoked before transaction');
    let writes = 0;
    const manager = {
      query: async () => [],
      getRepository: () => ({
        findOne: async () => ({ id: userId, displayName: 'Before' }),
        findBy: async () => [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: site }],
        update: async () => {
          writes++;
        },
      }),
    };
    const db = {
      transaction: async (first: unknown, second: unknown) =>
        ((typeof first === 'function' ? first : second) as (manager: unknown) => Promise<unknown>)(
          manager,
        ),
    };
    const users = {
      createInTransaction: async () => {
        writes++;
        return { id: userId };
      },
    };
    const workforce = {
      createContractorWithParticipation: async () => {
        writes++;
        return { id: contractorId };
      },
      assignRepresentativeInTransaction: async () => {
        writes++;
      },
      requireExclusiveRepresentativeSite: async () => undefined,
    };
    const service = new SiteRepresentativesService(db as never, users as never, workforce as never);
    const context = {
      actorUserId: randomUUID(),
      reauthorize: async () => {
        throw denied;
      },
    };
    const account = {
      username: 'synthetic-rep',
      displayName: 'Synthetic Rep',
      temporaryPassword: 'Synthetic_Rep_123',
    };
    const args =
      operation === 'create'
        ? [site, contractorId, account, context]
        : operation === 'rename'
          ? [site, userId, { expectedName: 'Before', name: 'After' }, context]
          : [
              site,
              {
                ...account,
                contractorName: 'Synthetic Contractor',
                validFrom: '2025-01-01T00:00:00Z',
                validUntil: null,
              },
              context,
            ];
    await assert.rejects(
      Reflect.apply(service[operation], service, args),
      (error) => error === denied,
    );
    assert.equal(writes, 0);
  });
}

test('all representative HTTP writers forward the original request for transactional authentication', async () => {
  const actor = randomUUID(),
    site = randomUUID(),
    resource = randomUUID();
  const request = { user: { id: actor }, headers: { authorization: 'Bearer synthetic-original' } };
  let context: MainConfigurationCommandContext | undefined,
    rechecks = 0;
  const manager = {};
  const auth = {
    authenticateRequest: async (actual: unknown, transaction: unknown) => {
      assert.equal(actual, request);
      assert.equal(transaction, manager);
      rechecks++;
    },
  };
  const capture = async (...args: unknown[]) => {
    context = args.at(-1) as MainConfigurationCommandContext;
    return { id: resource };
  };
  const controller = new SiteRepresentativesController(
    {
      create: capture,
      createWithContractor: capture,
      rename: capture,
    } as never,
    {} as never,
    auth as never,
  );
  for (const operation of ['create', 'createWithContractor', 'rename'] as const) {
    const args =
      operation === 'create'
        ? [request, site, resource, {}]
        : operation === 'rename'
          ? [request, site, resource, {}]
          : [request, site, {}];
    await Reflect.apply(controller[operation], controller, args);
    assert.equal(context?.actorUserId, actor);
    await context!.reauthorize!(manager as never);
  }
  assert.equal(rechecks, 3);
});
