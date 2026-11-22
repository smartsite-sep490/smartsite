import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { SiteConfigurationGuard } from '../src/modules/auth/site-configuration.guard.js';
import { assertSafetySiteAccess } from '../src/modules/safety/alerts/safety-alert-access.guard.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';

const admin = {
  id: 'admin',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
} as AuthenticatedUser;

function configuration(user: AuthenticatedUser, siteId = 'site-a', method = 'GET') {
  return new SiteConfigurationGuard().canActivate({
    switchToHttp: () => ({ getRequest: () => ({ user, method, params: { siteId } }) }),
  } as unknown as ExecutionContext);
}

test('global Admin cannot read camera configuration or safety evidence', () => {
  assert.throws(() => configuration(admin), { status: 403 });
  assert.throws(() => assertSafetySiteAccess(admin, 'site-a'), { status: 403 });
});
test('explicit site roles work only within their own site and write authority', () => {
  const manager = {
    ...admin,
    roleAssignments: [...admin.roleAssignments, { role: UserRole.SITE_MANAGER, siteId: 'site-a' }],
  };
  assert.equal(configuration(manager), true);
  assert.equal(configuration(manager, 'site-a', 'POST'), true);
  assert.throws(() => configuration(manager, 'site-b'), { status: 403 });
  const safety = {
    ...admin,
    roleAssignments: [
      ...admin.roleAssignments,
      { role: UserRole.SAFETY_OFFICER, siteId: 'site-a' },
    ],
  };
  assert.equal(configuration(safety), true);
  assert.throws(() => configuration(safety, 'site-a', 'POST'), { status: 403 });
  assert.doesNotThrow(() => assertSafetySiteAccess(safety, 'site-a'));
  assert.throws(() => assertSafetySiteAccess(safety, 'site-b'), { status: 403 });
  assert.throws(() => configuration({ ...manager, mustChangePassword: true }), { status: 403 });
  assert.throws(() => assertSafetySiteAccess(safety, undefined), { status: 403 });
});
