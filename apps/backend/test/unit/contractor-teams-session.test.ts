import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { ContractorTeamsController } from '../../src/modules/workforce/teams/contractor-teams.controller.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';

for (const operation of [
  'create',
  'update',
  'archive',
  'assign',
  'grantZone',
  'updateZone',
  'revokeZone',
] as const) {
  test(`Team HTTP ${operation} carries original bearer into transactional reauthorization`, async () => {
    const request = {
      user: { id: 'actor', mustChangePassword: false },
      headers: { authorization: 'Bearer synthetic' },
    };
    const manager = {};
    let calls = 0;
    const auth = {
      authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
        assert.equal(actualRequest, request);
        assert.equal(actualManager, manager);
        calls++;
        throw new UnauthorizedException();
      },
    };
    const serviceMethod = operation === 'updateZone' ? 'grantZone' : operation;
    const service = {
      [serviceMethod]: async (...args: unknown[]) => {
        if (operation === 'grantZone') assert.equal(args[5], undefined);
        if (operation === 'updateZone') assert.equal(args[5], 'permission');
        const context = args.at(-1) as MainConfigurationCommandContext;
        assert.equal(context.actorUserId, request.user.id);
        assert.equal(typeof context.reauthorize, 'function');
        await context.reauthorize!(manager as never);
      },
    };
    const controller = Reflect.construct(ContractorTeamsController, [
      service,
      auth,
    ]) as ContractorTeamsController;
    const args =
      operation === 'create'
        ? [request, 'site', 'contractor', {}]
        : operation === 'updateZone'
          ? [request, 'site', 'contractor', 'team', 'permission', {}]
          : [request, 'site', 'contractor', 'team', operation === 'revokeZone' ? 'permission' : {}];
    await assert.rejects(
      Reflect.apply(controller[operation], controller, args),
      (error: { getStatus?: () => number }) => error.getStatus?.() === 401,
    );
    assert.equal(calls, 1);
  });
}
