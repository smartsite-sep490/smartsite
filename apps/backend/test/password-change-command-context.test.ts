import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import type { EntityManager } from 'typeorm';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.service.js';
import type { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import {
  configurationCommandContext,
  passwordChangeCommandContext,
} from '../src/modules/auth/configuration-command-context.js';

const actor = '00000000-0000-4000-8000-000000000001';
function fixture(temporary: boolean, swap = false) {
  const request = { user: { id: actor, mustChangePassword: temporary } } as AuthenticatedRequest;
  const manager = {} as EntityManager;
  let calls = 0;
  const guard = {
    authenticateRequest: async (value: AuthenticatedRequest, transaction: EntityManager) => {
      assert.equal(value, request);
      assert.equal(transaction, manager);
      calls++;
      if (swap) value.user = { ...value.user!, id: 'different-actor' };
    },
  } as unknown as UserAuthGuard;
  return { request, manager, guard, calls: () => calls };
}

test('self-password context allows a temporary account after original-request transaction reauth', async () => {
  const f = fixture(true);
  const context = passwordChangeCommandContext(f.request, f.guard);
  assert.equal(context.actorUserId, actor);
  await context.reauthorize!(f.manager);
  assert.equal(f.calls(), 1);
});

test('management context still denies a temporary account after transaction reauth', async () => {
  const f = fixture(true);
  await assert.rejects(
    configurationCommandContext(f.request, f.guard).reauthorize!(f.manager),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.publicPayload.code === 'PASSWORD_CHANGE_REQUIRED',
  );
  assert.equal(f.calls(), 1);
});

for (const create of [passwordChangeCommandContext, configurationCommandContext]) {
  test(`${create.name} refuses a swapped transaction actor`, async () => {
    const f = fixture(false, true);
    await assert.rejects(create(f.request, f.guard).reauthorize!(f.manager), UnauthorizedException);
  });
  test(`${create.name} refuses missing authenticated request user`, () => {
    const f = fixture(false);
    delete f.request.user;
    assert.throws(() => create(f.request, f.guard), UnauthorizedException);
  });
  test(`${create.name} propagates original bearer revocation`, async () => {
    const f = fixture(false);
    f.guard.authenticateRequest = async () => {
      throw new UnauthorizedException();
    };
    await assert.rejects(create(f.request, f.guard).reauthorize!(f.manager), UnauthorizedException);
  });
}
