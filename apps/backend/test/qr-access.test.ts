import 'reflect-metadata';
import type { WorkforceActor } from '../src/modules/workforce/directory/contractor-operations.service.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { command } from '../src/common/configuration/commands.js';
import { requireSiteRole, requireGate, visitResponse } from '../src/modules/workforce/access/qr-access.service.js';
import type { VisitorVisitEntity } from '../src/database/entities/qr-access.entity.js';
import {
  RegisterVisitCommand,
  VerifyVisitorQrCommand,
  VerifyWorkerQrCommand,
  IssueWorkerQrCommand,
  CameraFallbackCommand,
  ConfirmPassageCommand,
} from '../src/modules/workforce/access/qr-access.commands.js';
import { UserRole } from '../src/database/entities/user.entity.js';

test('worker issues its own code by direction and Security accepts short or legacy credentials', () => {
  const requestId = randomUUID();
  assert.equal(command(IssueWorkerQrCommand, { direction: 'IN' }).direction, 'IN');
  assert.equal(command(IssueWorkerQrCommand, { direction: 'OUT' }).direction, 'OUT');
  const legacy = randomUUID();
  assert.equal(
    command(IssueWorkerQrCommand, { fallbackSessionId: legacy }).fallbackSessionId,
    legacy,
  );
  assert.throws(() => command(IssueWorkerQrCommand, { fallbackSessionId: 'ABCD2345' }));
  assert.throws(() => command(IssueWorkerQrCommand, { direction: 'SIDE' }));
  assert.equal(
    command(VerifyWorkerQrCommand, {
      token: ' abcd2345 ',
      direction: 'IN',
      requestId,
      fallbackSessionId: legacy,
    }).token,
    'ABCD2345',
  );
  command(VerifyWorkerQrCommand, { token: 'SSQ-' + 'a'.repeat(64), direction: 'OUT', requestId });
  for (const token of ['', 'ABCD1234', 'ABCD234', 'ABCD23456', 'ABCDO234', 'ABCDI234', 'ABCD 2345'])
    assert.throws(() => command(VerifyWorkerQrCommand, { token, direction: 'IN', requestId }));
});
test('separate-passage confirmation does not coerce booleans or accept forged authority fields', () => {
  const input = {
    idempotencyKey: randomUUID(),
    separatePassage: true,
    reviewNote: 'A distinct physical entry',
  };
  command(ConfirmPassageCommand, input);
  assert.throws(() => command(ConfirmPassageCommand, { ...input, separatePassage: 'true' }));
  assert.throws(() => command(ConfirmPassageCommand, { ...input, separatePassage: null }));
  assert.throws(() => command(ConfirmPassageCommand, { ...input, workerId: randomUUID() }));
});
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
    email: 'synthetic@example.test',
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
  assert.doesNotThrow(() =>
    command(RegisterVisitCommand, { ...registration, siteManagerId: randomUUID() }),
  );
  assert.throws(() => command(RegisterVisitCommand, { ...registration, siteManagerId: 'invalid' }));
});

test('visitResponse enforces expiration consistently and preserves canonical statuses', () => {
  const baseEntity = {
    id: randomUUID(),
    siteId: randomUUID(),
    representativeVisitorId: randomUUID(),
    siteManagerId: randomUUID(),
    version: 1,
    reviewNote: null,
    accessKeyHash: 'hash',
    visitorName: 'Synthetic Visitor',
    company: 'Test Corp',
    contact: '0123456789',
    hostName: 'Host Person',
    purpose: 'Inspection',
    targetArea: 'Main Zone',
    groupSize: 2,
    members: [],
    email: null,
    language: 'en' as const,
    bookingCodeHash: null,
    bookingCodeCiphertext: null,
    emailStatus: 'NOT_REQUESTED' as const,
    emailAttempts: 0,
    emailAttemptedAt: null,
    emailSentAt: null,
    emailNextAttemptAt: null,
    gateId: 'gate-north-01',
    validFrom: new Date(Date.now() - 3600_000),
    validUntil: new Date(Date.now() + 3600_000),
    status: 'PENDING' as const,
    enteredCount: 0,
    exitedCount: 0,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as VisitorVisitEntity;

  // Active PENDING remains PENDING
  assert.equal(visitResponse(baseEntity).status, 'PENDING');

  // Overdue PENDING evaluates to EXPIRED
  const overduePending = {
    ...baseEntity,
    validUntil: new Date(Date.now() - 10_000),
  };
  assert.equal(visitResponse(overduePending).status, 'EXPIRED');

  // Active APPROVED remains APPROVED
  const activeApproved = {
    ...baseEntity,
    status: 'APPROVED' as const,
  };
  assert.equal(visitResponse(activeApproved).status, 'APPROVED');

  // Overdue APPROVED evaluates to EXPIRED
  const overdueApproved = {
    ...baseEntity,
    status: 'APPROVED' as const,
    validUntil: new Date(Date.now() - 10_000),
  };
  assert.equal(visitResponse(overdueApproved).status, 'EXPIRED');

  // Past REJECTED and CANCELLED stay unchanged
  const overdueRejected = {
    ...baseEntity,
    status: 'REJECTED' as const,
    validUntil: new Date(Date.now() - 10_000),
  };
  assert.equal(visitResponse(overdueRejected).status, 'REJECTED');

  const overdueCancelled = {
    ...baseEntity,
    status: 'CANCELLED' as const,
    validUntil: new Date(Date.now() - 10_000),
  };
  assert.equal(visitResponse(overdueCancelled).status, 'CANCELLED');
});

test('visitResponse computes presence states and preserves NEEDS_REVIEW for uncertain attendance', () => {
  const baseEntity = {
    id: randomUUID(),
    siteId: randomUUID(),
    representativeVisitorId: randomUUID(),
    siteManagerId: randomUUID(),
    version: 1,
    reviewNote: null,
    accessKeyHash: 'hash',
    visitorName: 'Synthetic Visitor',
    company: 'Test Corp',
    contact: '0123456789',
    hostName: 'Host Person',
    purpose: 'Inspection',
    targetArea: 'Main Zone',
    groupSize: 4,
    members: [],
    email: null,
    language: 'en' as const,
    bookingCodeHash: null,
    bookingCodeCiphertext: null,
    emailStatus: 'NOT_REQUESTED' as const,
    emailAttempts: 0,
    emailAttemptedAt: null,
    emailSentAt: null,
    emailNextAttemptAt: null,
    gateId: 'gate-north-01',
    validFrom: new Date(),
    validUntil: new Date(Date.now() + 3600_000),
    status: 'APPROVED' as const,
    enteredCount: 0,
    exitedCount: 0,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as VisitorVisitEntity;

  // Not yet entered
  assert.equal(visitResponse(baseEntity).presence, 'OUTSIDE');

  // Whole group inside without roster
  assert.equal(
    visitResponse({ ...baseEntity, enteredCount: 4, exitedCount: 0 }).presence,
    'INSIDE',
  );

  // Partial group inside without roster -> NEEDS_REVIEW (legacy uncertain)
  assert.equal(
    visitResponse({ ...baseEntity, enteredCount: 2, exitedCount: 0 }).presence,
    'NEEDS_REVIEW',
  );

  // Partial group inside WITH roster -> INSIDE
  const rosterMembers = [
    { id: 'm1', fullName: 'A', identityNumber: '1', registeredFullName: 'A', registeredIdentityNumber: '1', inside: true },
    { id: 'm2', fullName: 'B', identityNumber: '2', registeredFullName: 'B', registeredIdentityNumber: '2', inside: false },
  ];
  assert.equal(
    visitResponse({ ...baseEntity, members: rosterMembers, enteredCount: 1, exitedCount: 0 }).presence,
    'INSIDE',
  );

  // Everyone checked out
  assert.equal(
    visitResponse({ ...baseEntity, enteredCount: 4, exitedCount: 4 }).presence,
    'OUTSIDE',
  );
});
