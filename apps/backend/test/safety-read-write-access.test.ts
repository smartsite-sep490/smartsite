import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { UserRole } from '../src/database/entities/user.entity.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import { SafetyAlertAccessGuard } from '../src/modules/safety/alerts/safety-alert-access.guard.js';

const site = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const user = (role: UserRole, siteId: string | null): AuthenticatedUser => ({
  id: other,
  username: 'synthetic-reviewer',
  displayName: 'Reviewer',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [{ role, siteId }],
});
function access(actor: AuthenticatedUser | undefined, method?: string) {
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user: actor, params: { siteId: site }, method }) }),
  } as unknown as ExecutionContext;
  return new SafetyAlertAccessGuard().canActivate(context);
}
test('global Admin can read Safety resources with GET and HEAD only', () => {
  const admin = user(UserRole.ADMIN, null);
  assert.equal(access(admin, 'GET'), true);
  assert.equal(access(admin, 'HEAD'), true);
  for (const method of [undefined, 'POST', 'PATCH', 'DELETE'])
    assert.throws(
      () => access(admin, method),
      (e: unknown) => (e as { getStatus(): number }).getStatus() === 403,
    );
});
test('scoped Safety Officer retains write authority without granting a foreign Site', () => {
  assert.equal(access(user(UserRole.SAFETY_OFFICER, site), 'POST'), true);
  assert.throws(() => access(user(UserRole.SAFETY_OFFICER, other), 'GET'));
  assert.throws(() => access(user(UserRole.SITE_MANAGER, site), 'GET'));
});
test('missing session and password-change state fail closed', () => {
  assert.throws(
    () => access(undefined, 'GET'),
    (e: unknown) => (e as { getStatus(): number }).getStatus() === 401,
  );
  assert.throws(() => access({ ...user(UserRole.ADMIN, null), mustChangePassword: true }, 'GET'));
});
