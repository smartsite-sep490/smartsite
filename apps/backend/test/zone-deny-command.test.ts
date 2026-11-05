import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ZoneAccessManagementService } from '../src/modules/zones/zone-access-management.service.js';
import { ZoneAccessEffect } from '../src/database/entities/zone-access-grant.entity.js';

for (const operation of ['create', 'revoke'] as const) {
  test(`Zone DENY ${operation} reauthenticates before any resource write, including repeated revoke`, async () => {
    const denied = new Error('Synthetic revoked session');
    let writes = 0;
    const repository = {
      findOneBy: async () => ({ id: randomUUID(), revokedAt: new Date() }),
      save: async () => {
        writes++;
        return {};
      },
      update: async () => {
        writes++;
      },
    };
    const manager = { query: async () => [], getRepository: () => repository };
    const service = new ZoneAccessManagementService({
      getRepository: () => repository,
      transaction: async (_isolation: unknown, work: (m: unknown) => Promise<unknown>) =>
        work(manager),
    } as never);
    const context = {
      actorUserId: randomUUID(),
      reauthorize: async () => {
        throw denied;
      },
    };
    const args =
      operation === 'create'
        ? [
            randomUUID(),
            randomUUID(),
            {
              workerId: randomUUID(),
              effect: ZoneAccessEffect.DENY,
              validFrom: '2026-01-01T00:00:00Z',
              validUntil: null,
            },
            context,
          ]
        : [randomUUID(), randomUUID(), randomUUID(), new Date(), context];
    await assert.rejects(
      Reflect.apply(
        operation === 'create' ? service.createGrant : service.revokeGrant,
        service,
        args,
      ),
      (error) => error === denied,
    );
    assert.equal(writes, 0);
  });
}

for (const operation of ['create', 'revoke'] as const) {
  test(`Zone DENY ${operation} forwards the original HTTP request for transaction reauthentication`, async () => {
    const { ZoneAccessController } = await import('../src/modules/zones/zone-access.controller.js');
    const actor = randomUUID(),
      site = randomUUID(),
      zone = randomUUID(),
      worker = randomUUID();
    const request = { user: { id: actor } },
      manager = {};
    let rechecks = 0;
    const invoke = async (...args: unknown[]) => {
      assert.equal(args[0], site);
      assert.equal(args[1], zone);
      const context = args.at(-1) as {
        actorUserId: string;
        reauthorize: (m: unknown) => Promise<void>;
      };
      assert.equal(context.actorUserId, actor);
      await context.reauthorize(manager);
      return { id: randomUUID() };
    };
    const controller = new ZoneAccessController(
      { createGrant: invoke, revokeGrant: invoke } as never,
      {
        authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
          assert.equal(actualRequest, request);
          assert.equal(actualManager, manager);
          rechecks++;
        },
      } as never,
    );
    if (operation === 'create')
      await controller.create(request as never, site, zone, {
        workerId: worker,
        effect: ZoneAccessEffect.DENY,
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: null,
      });
    else await controller.revoke(request as never, site, zone, randomUUID());
    assert.equal(rechecks, 1);
  });
}
