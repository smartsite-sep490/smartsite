import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import { assertCameraMonitoringSiteAccess } from '../src/modules/cameras/camera-monitoring-access.js';
import { assertSafetySiteAccess } from '../src/modules/safety/alerts/safety-alert-access.guard.js';

const SITE_A = randomUUID();
const SITE_B = randomUUID();

function makeUser(
  overrides: Partial<AuthenticatedUser> & {
    roleAssignments?: AuthenticatedUser['roleAssignments'];
  } = {},
): AuthenticatedUser {
  return {
    id: randomUUID(),
    username: 'user',
    displayName: 'Test User',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [],
    ...overrides,
  };
}

const forbidden = (error: unknown) =>
  error instanceof PublicHttpException &&
  error.getStatus() === 403 &&
  error.publicPayload.code === 'FORBIDDEN';

const passwordChangeRequired = (error: unknown) =>
  error instanceof PublicHttpException &&
  error.getStatus() === 403 &&
  error.publicPayload.code === 'PASSWORD_CHANGE_REQUIRED';

test('assertCameraMonitoringSiteAccess allows active SITE_MANAGER or SAFETY_OFFICER strictly on assigned site', () => {
  for (const role of [UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER] as const) {
    const user = makeUser({ roleAssignments: [{ role, siteId: SITE_A }] });
    assert.doesNotThrow(() => assertCameraMonitoringSiteAccess(user, SITE_A));
    assert.doesNotThrow(() => assertCameraMonitoringSiteAccess(user, SITE_A.toUpperCase()));
  }
});

test('assertCameraMonitoringSiteAccess denies missing, inactive, password-change-required, global admin, unassigned, cross-site, and other roles', () => {
  assert.throws(
    () => assertCameraMonitoringSiteAccess(undefined, SITE_A),
    (error: unknown) => error instanceof UnauthorizedException,
  );

  const inactiveManager = makeUser({
    isActive: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: SITE_A }],
  });
  assert.throws(() => assertCameraMonitoringSiteAccess(inactiveManager, SITE_A), forbidden);

  for (const role of [UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER] as const) {
    const passwordBlocked = makeUser({
      mustChangePassword: true,
      roleAssignments: [{ role, siteId: SITE_A }],
    });
    assert.throws(
      () => assertCameraMonitoringSiteAccess(passwordBlocked, SITE_A),
      passwordChangeRequired,
    );
  }

  for (const [role, assignedSite] of [
    [UserRole.ADMIN, null],
    [UserRole.ADMIN, SITE_A],
    [UserRole.SITE_MANAGER, null],
    [UserRole.SAFETY_OFFICER, null],
    [UserRole.SITE_MANAGER, SITE_B],
    [UserRole.SAFETY_OFFICER, SITE_B],
    [UserRole.WORKER, SITE_A],
    [UserRole.SECURITY_OFFICER, SITE_A],
    [UserRole.CONTRACTOR_REPRESENTATIVE, SITE_A],
  ] as const) {
    const deniedUser = makeUser({
      roleAssignments: [{ role, siteId: assignedSite }],
    });
    assert.throws(() => assertCameraMonitoringSiteAccess(deniedUser, SITE_A), forbidden);
  }

  const managerUser = makeUser({
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: SITE_A }],
  });
  assert.throws(() => assertCameraMonitoringSiteAccess(managerUser, undefined), forbidden);
  assert.throws(() => assertCameraMonitoringSiteAccess(makeUser(), SITE_A), forbidden);
});

test('assertSafetySiteAccess remains strictly SAFETY_OFFICER-only while camera monitoring includes same-site SITE_MANAGER', () => {
  const manager = makeUser({
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: SITE_A }],
  });
  assert.doesNotThrow(() => assertCameraMonitoringSiteAccess(manager, SITE_A));
  assert.throws(() => assertSafetySiteAccess(manager, SITE_A), forbidden);
});
