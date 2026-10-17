import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { UserRole } from '../src/database/entities/user.entity.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { SiteConfigurationGuard } from '../src/modules/auth/site-configuration.guard.js';
import { SafetyAlertAccessGuard } from '../src/modules/safety/alerts/safety-alert-access.guard.js';
import { QrAccessService } from '../src/modules/workforce/access/qr-access.service.js';
import { FaceGateService } from '../src/modules/workforce/access/face-gate.service.js';
import { AttendanceService } from '../src/modules/workforce/attendance/attendance.service.js';
import { WorkerGatePermissionsService } from '../src/modules/workforce/access/worker-gate-permissions.service.js';
import { SiteAccessSetupService } from '../src/modules/workforce/access/site-access-setup.service.js';

const denied = (e: unknown) => e instanceof PublicHttpException && e.getStatus() === 403;
const site = randomUUID();
const actor = (role: UserRole, siteId: string | null = role === UserRole.ADMIN ? null : site) => ({
  id: randomUUID(),
  mustChangePassword: false,
  roleAssignments: [{ role, siteId }],
});
function context(
  role: UserRole,
  method: string,
  assignedSite: string | null = role === UserRole.ADMIN ? null : site,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method, params: { siteId: site }, user: actor(role, assignedSite) }),
    }),
  } as unknown as ExecutionContext;
}

test('operational configuration permits scoped managers, lets Admin observe, and denies other roles or sites', () => {
  const guard = new SiteConfigurationGuard();
  assert.equal(guard.canActivate(context(UserRole.SITE_MANAGER, 'POST')), true);
  assert.equal(guard.canActivate(context(UserRole.ADMIN, 'GET')), true);
  assert.equal(guard.canActivate(context(UserRole.SAFETY_OFFICER, 'GET')), true);
  for (const role of [
    UserRole.ADMIN,
    UserRole.SAFETY_OFFICER,
    UserRole.SECURITY_OFFICER,
    UserRole.CONTRACTOR_REPRESENTATIVE,
    UserRole.WORKER,
  ]) {
    assert.throws(() => guard.canActivate(context(role, 'PATCH')), denied);
  }
  assert.throws(
    () => guard.canActivate(context(UserRole.SITE_MANAGER, 'POST', randomUUID())),
    denied,
  );
});

test('Admin observes alerts but only exact-Site Safety Officer records review decisions', () => {
  const guard = new SafetyAlertAccessGuard();
  assert.equal(guard.canActivate(context(UserRole.ADMIN, 'GET')), true);
  assert.throws(() => guard.canActivate(context(UserRole.ADMIN, 'POST')), denied);
  assert.equal(guard.canActivate(context(UserRole.SAFETY_OFFICER, 'POST')), true);
  assert.throws(
    () => guard.canActivate(context(UserRole.SAFETY_OFFICER, 'POST', randomUUID())),
    denied,
  );
});

test('non-Security actors cannot scan faces/QR, open fallback, or confirm gate passage before any persistence', async () => {
  const source = undefined as unknown as DataSource;
  const qr = new QrAccessService(source);
  const face = new FaceGateService(source);
  for (const role of [
    UserRole.ADMIN,
    UserRole.SITE_MANAGER,
    UserRole.SAFETY_OFFICER,
    UserRole.CONTRACTOR_REPRESENTATIVE,
    UserRole.WORKER,
  ]) {
    const user = actor(role);
    await assert.rejects(face.verify(user, site, 'gate-north-01', undefined), denied);
    await assert.rejects(
      qr.previewVisitorQr(user, site, 'gate-north-01', { token: 'ABCD2345' }),
      denied,
    );
    await assert.rejects(
      qr.openFallback(user, site, 'gate-north-01', 'IN', 'AI_UNAVAILABLE'),
      denied,
    );
    await assert.rejects(
      qr.confirmPassage(user, site, randomUUID(), { idempotencyKey: randomUUID() }),
      denied,
    );
  }
  await assert.rejects(
    qr.openFallback(
      actor(UserRole.SECURITY_OFFICER, randomUUID()),
      site,
      'gate-north-01',
      'IN',
      'AI_UNAVAILABLE',
    ),
    denied,
  );
});

test('Admin cannot grant operational permissions; attendance corrections require a representative role', async () => {
  const source = undefined as unknown as DataSource;
  const user = actor(UserRole.ADMIN);
  await assert.rejects(
    new AttendanceService(source).overview(actor(UserRole.SECURITY_OFFICER), site),
    denied,
  );
  await assert.rejects(
    new WorkerGatePermissionsService(source).set(user, site, randomUUID(), {
      gateIds: [],
      expectedPermissionIds: [],
    }),
    denied,
  );
  await assert.rejects(
    new SiteAccessSetupService(source).grantContractor(user, site, {} as never),
    denied,
  );
  for (const role of [UserRole.ADMIN, UserRole.SITE_MANAGER, UserRole.SECURITY_OFFICER]) {
    await assert.rejects(
      new AttendanceService(source).reviewCorrection(actor(role), site, randomUUID(), {
        approve: true,
        reviewNote: 'Synthetic decision',
      }),
      denied,
    );
  }
});
