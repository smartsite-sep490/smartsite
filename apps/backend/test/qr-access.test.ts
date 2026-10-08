import 'reflect-metadata';
import type { WorkforceActor } from '../src/modules/workforce/contractor-operations.service.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { command } from '../src/common/configuration/commands.js';
import { requireSiteRole, requireGate } from '../src/modules/workforce/qr-access.service.js';
import {
  RegisterVisitCommand,
  VerifyVisitorQrCommand,
  VerifyWorkerQrCommand,
  CameraFallbackCommand,
} from '../src/modules/workforce/qr-access.commands.js';
import { UserRole } from '../src/database/entities/user.entity.js';
test('visitor approval requires a Site Manager assignment for the exact registered site', () => {
  const siteId = randomUUID();
  const actor: WorkforceActor = {
    id: randomUUID(),
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  };
  requireSiteRole(actor, siteId, [UserRole.SITE_MANAGER], false);
  for (const denied of [
    { ...actor, mustChangePassword: true },
    { ...actor, roleAssignments: [] },
    { ...actor, roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: randomUUID() }] },
    { ...actor, roleAssignments: [{ role: UserRole.ADMIN, siteId: null }] },
    { ...actor, roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId }] },
  ]) {
    assert.throws(() => requireSiteRole(denied, siteId, [UserRole.SITE_MANAGER], false));
  }
});
test('QR commands reject fabricated authorization, subject IDs, invalid counts and missing timezone', () => {
  const qr: VerifyWorkerQrCommand = {
    token: 'SSQ-' + 'a'.repeat(64),
    direction: 'IN',
    requestId: randomUUID(),
  };
  command(VerifyVisitorQrCommand, { ...qr, count: 1 });
  for (const count of [0, -1, 1.5, 1001, '1'])
    assert.throws(() => command(VerifyVisitorQrCommand, { ...qr, count }));
  assert.throws(() => command(VerifyWorkerQrCommand, { ...qr, authorization: 'ALLOWED' }));
  assert.throws(() => command(VerifyWorkerQrCommand, { ...qr, workerId: randomUUID() }));
  assert.throws(() => command(CameraFallbackCommand, { direction: 'IN', reason: 'DENIED' }));
  assert.throws(() => requireGate('unconfigured-gate'));
  const registration = {
    requestId: randomUUID(),
    accessKey: 'a'.repeat(64),
    visitorName: 'Synthetic visitor',
    company: '',
    contact: 'synthetic@example.test',
    hostName: 'Synthetic host',
    purpose: 'Synthetic tour',
    targetArea: 'Office',
    groupSize: 2,
    gateId: 'gate-north-01',
    validFrom: '2026-10-03T10:00:00Z',
    validUntil: '2026-10-03T11:00:00Z',
  };
  command(RegisterVisitCommand, registration);
  assert.throws(() =>
    command(RegisterVisitCommand, { ...registration, validFrom: '2026-10-03T10:00:00' }),
  );
  assert.throws(() =>
    command(RegisterVisitCommand, { ...registration, siteManagerId: randomUUID() }),
  );
});
