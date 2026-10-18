import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  SiteEntity,
  UserEntity,
  UserRole,
  WorkerEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorRepresentativeGrantEntity,
  ZoneEntity,
  ZoneType,
  ZoneRestrictionPolicy,
  WorkerSiteZoneAssignmentEntity,
  AccessAttemptEntity,
  GateEventEntity,
  AttendanceEventEntity,
  AttendanceSessionEntity,
  UserRoleAssignmentEntity,
  ContractorRepresentativeAssignmentEntity,
  AccessAuditEntity,
} from '../../src/database/entities/index.js';
import { MainAssignmentCommandService } from '../../src/modules/zones/main-assignment-command.service.js';
import { SiteAccessSetupService } from '../../src/modules/workforce/access/site-access-setup.service.js';
import { WorkerGatePermissionsService } from '../../src/modules/workforce/access/worker-gate-permissions.service.js';
import { QrAccessService } from '../../src/modules/workforce/access/qr-access.service.js';
import { AttendanceService } from '../../src/modules/workforce/attendance/attendance.service.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { assignTestShift } from '../support/assigned-shift.js';
import { approvedWorkerDocuments } from '../support/approved-worker-documents.js';

const database = createIsolatedTestDatabase({ canonical: true });
const dataSource = database.dataSource;

test('ERD: bounded permissions, gate confirmation, temporary passage and attendance corrections', async () => {
  const siteId = randomUUID(),
    otherSiteId = randomUUID(),
    contractorId = randomUUID(),
    participationId = randomUUID(),
    workerId = randomUUID(),
    zoneId = randomUUID();
  const managerId = randomUUID(),
    representativeId = randomUUID(),
    securityId = randomUUID(),
    workerAccountId = randomUUID(),
    outsiderId = randomUUID();
  const users = [managerId, representativeId, securityId, workerAccountId, outsiderId];
  const actor = (id: string, role: UserRole, scope = siteId) => ({
    id,
    mustChangePassword: false,
    roleAssignments: [{ role, siteId: scope }],
  });
  const manager = actor(managerId, UserRole.SITE_MANAGER),
    rep = actor(representativeId, UserRole.CONTRACTOR_REPRESENTATIVE),
    security = actor(securityId, UserRole.SECURITY_OFFICER),
    worker = actor(workerAccountId, UserRole.WORKER);
  const from = new Date(Date.now() - 60_000).toISOString(),
    until = new Date(Date.now() + 3600_000).toISOString();
  const operations = new MainAssignmentCommandService(dataSource),
    setup = new SiteAccessSetupService(dataSource),
    access = new QrAccessService(dataSource),
    attendance = new AttendanceService(dataSource);
  const gateId = 'gate-north-01';
  try {
    await database.initialize();
    const [{ owned_schema: ownedSchema }] = await dataSource.query(
      'SELECT current_schema() AS owned_schema',
    );
    assert.match(ownedSchema, /^isolated_test_[0-9a-f]{32}$/);
    for (const id of [siteId, otherSiteId])
      await dataSource.getRepository(SiteEntity).save({ id, code: id, name: 'Synthetic ERD site' });
    for (const id of users)
      await dataSource.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic account',
        passwordHash: 'synthetic-not-login',
        isActive: true,
        mustChangePassword: false,
      });
    for (const [userId, role] of [
      [managerId, UserRole.SITE_MANAGER],
      [representativeId, UserRole.CONTRACTOR_REPRESENTATIVE],
      [securityId, UserRole.SECURITY_OFFICER],
      [workerAccountId, UserRole.WORKER],
      [outsiderId, UserRole.WORKER],
    ] as const)
      await dataSource
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId, role, siteId });
    await dataSource
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await dataSource.getRepository(ContractorSiteParticipationEntity).save({
      id: participationId,
      siteId,
      contractorId,
      validFrom: new Date(from),
      validUntil: new Date(until),
      isActive: true,
    });
    await dataSource
      .getRepository(ContractorRepresentativeGrantEntity)
      .save({ id: randomUUID(), userId: representativeId, contractorId });
    await dataSource
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .save({ id: randomUUID(), siteId, contractorId, userId: representativeId });
    await dataSource.getRepository(WorkerEntity).save({
      id: workerId,
      siteId,
      contractorId,
      userId: workerAccountId,
      externalId: workerId,
      displayName: 'Synthetic worker',
      isActive: true,
    });
    await dataSource.getRepository(ZoneEntity).save({
      id: zoneId,
      siteId,
      code: zoneId,
      name: 'Synthetic restricted zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
      requiredPpe: [],
      configurationLocked: false,
    });
    await assert.rejects(
      operations.publicRequest(
        workerId,
        {
          siteId,
          zoneIds: [zoneId],
          validFrom: from,
          validUntil: null,
        },
        { actorUserId: rep.id },
      ),
      /expiry/,
    );
    const assignment = await operations.publicRequest(
      workerId,
      {
        siteId,
        zoneIds: [zoneId],
        validFrom: from,
        validUntil: until,
      },
      { actorUserId: rep.id },
    );
    await dataSource.getRepository(UserRoleAssignmentEntity).save({
      id: randomUUID(),
      userId: outsiderId,
      role: UserRole.SITE_MANAGER,
      siteId: otherSiteId,
    });
    await assert.rejects(
      operations.publicDecision(
        assignment.id,
        { approve: true, expectedVersion: 1 },
        { actorUserId: outsiderId },
      ),
    );
    await operations.publicDecision(
      assignment.id,
      {
        approve: true,
        expectedVersion: 1,
        reviewNote: 'Validated participation',
      },
      { actorUserId: manager.id },
    );
    assert.equal(
      (
        await dataSource
          .getRepository(WorkerSiteZoneAssignmentEntity)
          .findOneByOrFail({ id: assignment.id })
      ).version,
      2,
    );
    const contractorPermission = await setup.grantContractor(manager, siteId, {
      requestId: randomUUID(),
      siteContractorId: participationId,
      zoneId,
      validFrom: from,
      validUntil: until,
    });
    await assert.rejects(
      setup.grantWorker(actor(outsiderId, UserRole.CONTRACTOR_REPRESENTATIVE), siteId, {
        requestId: randomUUID(),
        workerAssignmentId: assignment.id,
        contractorZonePermissionId: contractorPermission.id,
        validFrom: from,
        validUntil: until,
      }),
      /Representative/,
    );
    await assert.rejects(
      setup.grantWorker(rep, siteId, {
        requestId: randomUUID(),
        workerAssignmentId: assignment.id,
        contractorZonePermissionId: contractorPermission.id,
        validFrom: from,
        validUntil: new Date(Date.now() + 7200_000).toISOString(),
      }),
    );
    await setup.grantWorker(rep, siteId, {
      requestId: randomUUID(),
      workerAssignmentId: assignment.id,
      contractorZonePermissionId: contractorPermission.id,
      validFrom: from,
      validUntil: until,
    });
    const zoneInput = {
      eventId: randomUUID(),
      siteId,
      zoneId,
      verifiedWorkerId: workerId,
      trackId: 1,
      evaluatedAt: new Date(),
    };
    assert.equal(
      (
        await dataSource.transaction((m) =>
          new ZoneEntryAuthorizationService().decide(m, zoneInput),
        )
      ).status,
      'ALLOWED',
    );
    await setup.revoke(manager, siteId, contractorPermission.id, 'contractor');
    assert.equal(
      (
        await dataSource.transaction((m) =>
          new ZoneEntryAuthorizationService().decide(m, { ...zoneInput, evaluatedAt: new Date() }),
        )
      ).status,
      'DENIED',
    );
    const gatePermissions = new WorkerGatePermissionsService(dataSource);
    await gatePermissions.set(manager, siteId, workerId, {
      gateIds: [gateId],
      expectedPermissionIds: [],
    });
    const unknown = await dataSource.transaction((m) =>
      access.recordAttempt(m, {
        actor: security,
        siteId,
        gateId,
        direction: 'IN',
        method: 'FACE',
        identityStatus: 'UNKNOWN',
        authorization: 'UNAVAILABLE',
        reasonCode: 'UNKNOWN_FACE',
      }),
    );
    assert.equal(
      await dataSource.getRepository(AccessAttemptEntity).countBy({ id: unknown.id }),
      1,
    );
    await assert.rejects(
      access.confirmPassage(security, siteId, unknown.id, { idempotencyKey: randomUUID() }),
    );
    assert.equal(await dataSource.getRepository(GateEventEntity).countBy({ siteId }), 0);
    const passage = async (direction: 'IN' | 'OUT', separatePassage = false) => {
      const attempt = await access.manualWorker(security, siteId, gateId, {
        requestId: randomUUID(),
        workerId,
        direction,
        identityConfirmed: true,
        reviewNote: 'Security checked Worker identity',
      });
      assert.equal(attempt.status, 'READY');
      return access.confirmPassage(security, siteId, attempt.id, {
        idempotencyKey: randomUUID(),
        separatePassage,
        reviewNote: separatePassage
          ? 'Security confirmed a separate physical departure'
          : undefined,
      });
    };
    await approvedWorkerDocuments(dataSource, [workerId], managerId);
    await assignTestShift(dataSource, siteId, workerId);
    const entry = await passage('IN');
    assert.equal(await dataSource.getRepository(AttendanceEventEntity).countBy({ siteId }), 1);
    const checkIn = { requestId: randomUUID(), kind: 'CHECK_IN' as const };
    const opened = await attendance.record(security, siteId, entry.id, checkIn);
    assert.equal((await attendance.record(security, siteId, entry.id, checkIn)).id, opened.id);
    await passage('OUT');
    await passage('IN');
    assert.ok(
      (await dataSource.getRepository(AttendanceSessionEntity).findOneByOrFail({ id: opened.id }))
        .effectiveOutAt,
    );
    assert.equal(await dataSource.getRepository(AttendanceEventEntity).countBy({ siteId }), 3);
    const departure = await passage('OUT');
    await assert.rejects(
      attendance.record(security, siteId, departure.id, {
        requestId: randomUUID(),
        kind: 'CHECK_IN',
      }),
    );
    const closed = await attendance.record(security, siteId, departure.id, {
      requestId: randomUUID(),
      kind: 'CHECK_OUT',
    });
    assert.equal(closed.status, 'MATCHED');
    const rawEvents = await dataSource.getRepository(AttendanceEventEntity).findBy({ siteId });
    const originalPassages = await dataSource.getRepository(GateEventEntity).countBy({ siteId });
    const correctionInput = {
      requestId: randomUUID(),
      expectedSessionVersion: closed.version,
      proposedInAt: closed.effectiveInAt!,
      proposedOutAt: new Date().toISOString(),
      reason: 'Synthetic missed time',
    };
    await assert.rejects(
      attendance.requestCorrection(
        actor(outsiderId, UserRole.WORKER),
        siteId,
        closed.id,
        correctionInput,
      ),
    );
    const correction = await attendance.requestCorrection(
      worker,
      siteId,
      closed.id,
      correctionInput,
    );
    assert.deepEqual(
      await attendance.requestCorrection(worker, siteId, closed.id, correctionInput),
      correction,
    );
    const duplicates = await Promise.allSettled(
      [1, 2].map(() =>
        attendance.requestCorrection(worker, siteId, closed.id, {
          ...correctionInput,
          requestId: randomUUID(),
        }),
      ),
    );
    assert.equal(duplicates.filter((result) => result.status === 'rejected').length, 2);
    assert.equal(
      (await attendance.overview(worker, siteId, { dayId: randomUUID() })).hasPendingCorrection,
      true,
    );
    await assert.rejects(
      attendance.reviewCorrection(
        actor(workerAccountId, UserRole.SITE_MANAGER),
        siteId,
        correction.id,
        { approve: true, reviewNote: 'Self review denied' },
      ),
    );
    await attendance.reviewCorrection(rep, siteId, correction.id, {
      approve: true,
    });
    const updatedSession = await dataSource
      .getRepository(AttendanceSessionEntity)
      .findOneByOrFail({ id: closed.id });
    const stale = await attendance.requestCorrection(worker, siteId, closed.id, {
      ...correctionInput,
      requestId: randomUUID(),
      expectedSessionVersion: updatedSession.version,
    });
    await dataSource
      .getRepository(AttendanceSessionEntity)
      .update(closed.id, { version: updatedSession.version + 1 });
    await assert.rejects(
      attendance.reviewCorrection(rep, siteId, stale.id, {
        approve: true,
        reviewNote: 'Stale version denied',
      }),
      /changed/,
    );
    await assert.rejects(attendance.reviewCorrection(rep, siteId, stale.id, { approve: false }));
    await attendance.reviewCorrection(rep, siteId, stale.id, {
      approve: false,
      reviewNote: 'Recorded times changed',
    });
    assert.equal((await attendance.overview(worker, siteId)).hasPendingCorrection, false);
    const resubmission = await attendance.requestCorrection(worker, siteId, closed.id, {
      ...correctionInput,
      requestId: randomUUID(),
      expectedSessionVersion: updatedSession.version + 1,
    });
    await attendance.reviewCorrection(rep, siteId, resubmission.id, {
      approve: false,
      reviewNote: 'No further change needed',
    });
    assert.equal(
      (await dataSource.getRepository(AttendanceSessionEntity).findOneByOrFail({ id: closed.id }))
        .status,
      'CORRECTED',
    );
    assert.deepEqual(
      await dataSource.getRepository(AttendanceEventEntity).findBy({ siteId }),
      rawEvents,
    );
    assert.equal(
      await dataSource.getRepository(GateEventEntity).countBy({ siteId }),
      originalPassages,
    );
    const reserved = await access.manualWorker(security, siteId, gateId, {
      requestId: randomUUID(),
      workerId,
      direction: 'IN',
      identityConfirmed: true,
      reviewNote: 'Before revocation',
    });
    const current = await gatePermissions.list(manager, siteId, workerId);
    await gatePermissions.set(manager, siteId, workerId, {
      gateIds: [],
      expectedPermissionIds: current.items.map((p) => p.id),
    });
    await assert.rejects(
      access.confirmPassage(security, siteId, reserved.id, { idempotencyKey: randomUUID() }),
      /permission changed/,
    );
    await dataSource.getRepository(WorkerSiteZoneAssignmentEntity).update(assignment.id, {
      validFrom: new Date(Date.now() - 120_000),
      validUntil: new Date(Date.now() - 60_000),
    });
    assert.equal(
      (
        await access.manualWorker(security, siteId, gateId, {
          requestId: randomUUID(),
          workerId,
          direction: 'IN',
          identityConfirmed: true,
          reviewNote: 'Cannot override expiry',
        })
      ).status,
      'DENIED',
    );
    const latestAssignment = await dataSource
      .getRepository(WorkerSiteZoneAssignmentEntity)
      .findOneByOrFail({ id: assignment.id });
    await operations.publicRevoke(
      assignment.id,
      {
        expectedVersion: latestAssignment.version,
        reviewNote: 'Participation ended',
      },
      { actorUserId: manager.id },
    );
    await operations.publicRevoke(
      assignment.id,
      {
        expectedVersion: latestAssignment.version,
        reviewNote: 'Participation ended',
      },
      { actorUserId: manager.id },
    );
    assert.equal(
      (
        await dataSource
          .getRepository(WorkerSiteZoneAssignmentEntity)
          .findOneByOrFail({ id: assignment.id })
      ).status,
      'REVOKED',
    );
    await passage('OUT', true);
    assert.ok((await dataSource.getRepository(AccessAuditEntity).findBy({ siteId })).length > 10);
  } finally {
    await database.dispose();
  }
});
