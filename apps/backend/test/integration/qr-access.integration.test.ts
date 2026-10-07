import type {
  VerifyVisitorQrCommand,
  VerifyWorkerQrCommand,
} from '../../src/modules/workforce/qr-access.commands.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { QrAccessService } from '../../src/modules/workforce/qr-access.service.js';
import {
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  FaceProfileEntity,
  FaceProfileStatus,
  WorkerGatePermissionEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  GateEventEntity,
  VisitorVisitEntity,
  VisitorGateEventEntity,
  QrFallbackSessionEntity,
  GateAccessLogEntity,
} from '../../src/database/entities/index.js';
import dataSource from '../support/test-data-source.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
test('real PostgreSQL visitor approval, group counts, expiring QR, replay and worker fallback authorization', async () => {
  await dataSource.initialize();
  const sites: [string, string, string] = [randomUUID(), randomUUID(), randomUUID()];
  const users: [string, string, string, string] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const [siteId, otherSiteId, unstaffedSiteId] = sites;
  const [managerId, otherManagerId, securityId, accountId] = users;
  const actor = (id: string, role: UserRole, scope = siteId) => ({
    id,
    mustChangePassword: false,
    roleAssignments: [{ role, siteId: scope }],
  });
  const siteManager = actor(managerId, UserRole.SITE_MANAGER);
  const security = actor(securityId, UserRole.SECURITY_OFFICER);
  const workerActor = actor(accountId, UserRole.WORKER);
  const contractorId = randomUUID(),
    workerId = randomUUID();
  const participationId = randomUUID(),
    assignmentId = randomUUID();
  const service = new QrAccessService(dataSource);
  const gateId = 'gate-north-01';
  const registration = {
    requestId: randomUUID(),
    accessKey: 'b'.repeat(64),
    visitorName: 'Synthetic representative',
    company: 'Synthetic group',
    contact: 'synthetic@example.test',
    hostName: 'Synthetic host',
    purpose: 'Tour',
    targetArea: 'Office',
    groupSize: 20,
    gateId,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
  };
  try {
    for (const id of sites)
      await dataSource.getRepository(SiteEntity).save({ id, code: id, name: 'Synthetic QR site' });
    for (const id of users)
      await dataSource.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic QR account',
        passwordHash: 'synthetic-not-for-login',
        isActive: true,
        mustChangePassword: false,
      });
    for (const user of [
      siteManager,
      actor(otherManagerId, UserRole.SITE_MANAGER, otherSiteId),
      security,
      workerActor,
    ])
      await dataSource
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: user.id, ...user.roleAssignments[0] });
    await assert.rejects(
      service.register(unstaffedSiteId, { ...registration, requestId: randomUUID() }),
      /no active Site Manager/,
    );
    const visit = await service.register(siteId, registration);
    assert.equal(visit.status, 'PENDING');
    assert.equal('accessKeyHash' in visit, false);
    assert.equal((await service.register(siteId, registration)).id, visit.id);
    await assert.rejects(
      service.register(siteId, { ...registration, groupSize: 21 }),
      /different details/,
    );
    assert.equal(
      (await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })).pass,
      null,
    );
    await assert.rejects(service.visitorPass({ visitId: visit.id, accessKey: 'c'.repeat(64) }));
    await assert.rejects(
      service.decideVisit(
        actor(otherManagerId, UserRole.SITE_MANAGER, otherSiteId),
        siteId,
        visit.id,
        { status: 'APPROVED' },
      ),
    );
    await assert.rejects(service.decideVisit(security, siteId, visit.id, { status: 'APPROVED' }));
    assert.equal(
      (
        await service.listVisits(
          actor(otherManagerId, UserRole.SITE_MANAGER, otherSiteId),
          otherSiteId,
        )
      ).items.length,
      0,
    );
    await service.decideVisit(siteManager, siteId, visit.id, { status: 'APPROVED' });
    await assert.rejects(
      service.decideVisit(siteManager, siteId, visit.id, { status: 'REJECTED' }),
      /already been reviewed/,
    );
    const first = (
      await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })
    ).pass;
    assert.ok(first);
    const entry: VerifyVisitorQrCommand = {
      token: first.token,
      direction: 'IN',
      count: 20,
      requestId: randomUUID(),
    };
    await assert.rejects(service.visitorGate(security, otherSiteId, gateId, entry));
    await assert.rejects(service.visitorGate(security, siteId, 'gate-west-02', entry));
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, { ...entry, count: 18 }),
      /entire approved group/,
    );
    const concurrent = await Promise.all([
      service.visitorGate(security, siteId, gateId, entry),
      service.visitorGate(security, siteId, gateId, entry),
    ]);
    assert.equal(concurrent[0].id, concurrent[1].id);
    assert.equal(concurrent[0].visit.enteredCount, 20);
    assert.equal(concurrent[0].visit.presence, 'INSIDE');
    assert.equal(
      await dataSource.getRepository(VisitorGateEventEntity).countBy({ visitId: visit.id }),
      1,
    );
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, { ...entry, requestId: randomUUID() }),
      /already been used/,
    );
    const second = (
      await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })
    ).pass;
    assert.ok(second);
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, {
        ...entry,
        token: second.token,
        count: 3,
        requestId: randomUUID(),
      }),
      /direction/,
    );
    const rotated = (
      await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })
    ).pass;
    assert.ok(rotated);
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, {
        ...entry,
        token: second.token,
        count: 1,
        requestId: randomUUID(),
      }),
      /expired/,
    );
    await service.visitorGate(security, siteId, gateId, {
      token: rotated.token,
      direction: 'OUT',
      count: 20,
      requestId: randomUUID(),
    });
    const reentry = (
      await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })
    ).pass;
    assert.ok(reentry);
    assert.equal(reentry.direction, 'IN');
    const reentered = await service.visitorGate(security, siteId, gateId, {
      token: reentry.token,
      direction: 'IN',
      requestId: randomUUID(),
    });
    assert.equal(reentered.visit.enteredCount, 40);
    await dataSource.getRepository(VisitorVisitEntity).update(visit.id, {
      validFrom: new Date(Date.now() - 120_000),
      validUntil: new Date(Date.now() - 60_000),
    });
    const departure = (
      await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })
    ).pass;
    assert.ok(departure);
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, {
        token: departure.token,
        direction: 'IN',
        count: 1,
        requestId: randomUUID(),
      }),
      /direction/,
    );
    await service.visitorGate(security, siteId, gateId, {
      token: departure.token,
      direction: 'OUT',
      count: 20,
      requestId: randomUUID(),
    });
    assert.equal(
      (await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })).pass,
      null,
    );
    assert.equal(
      (await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })).visit
        .status,
      'EXPIRED',
    );
    const cancellable = await service.register(siteId, {
      ...registration,
      requestId: randomUUID(),
    });
    assert.equal(cancellable.siteManagerId, managerId);
    await service.decideVisit(siteManager, siteId, cancellable.id, {
      status: 'APPROVED',
      expectedVersion: 1,
    });
    const cancelledQr = (
      await service.visitorPass({ visitId: cancellable.id, accessKey: registration.accessKey })
    ).pass;
    assert.ok(cancelledQr);
    await assert.rejects(
      service.decideVisit(siteManager, siteId, cancellable.id, {
        status: 'CANCELLED',
        expectedVersion: 1,
        reviewNote: 'Changed plans',
      }),
      /changed/,
    );
    await service.decideVisit(siteManager, siteId, cancellable.id, {
      status: 'CANCELLED',
      expectedVersion: 2,
      reviewNote: 'Changed plans',
    });
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, {
        token: cancelledQr.token,
        direction: 'IN',
        requestId: randomUUID(),
      }),
      /revoked/,
    );
    const rejectedVisit = await service.register(siteId, {
      ...registration,
      requestId: randomUUID(),
    });
    await service.decideVisit(siteManager, siteId, rejectedVisit.id, { status: 'REJECTED' });
    assert.equal(
      (await service.visitorPass({ visitId: rejectedVisit.id, accessKey: registration.accessKey }))
        .pass,
      null,
    );
    const legacyVisit = await service.register(siteId, {
      ...registration,
      requestId: randomUUID(),
    });
    await service.decideVisit(siteManager, siteId, legacyVisit.id, { status: 'APPROVED' });
    await dataSource.getRepository(VisitorVisitEntity).update(legacyVisit.id, { enteredCount: 18 });
    const oldEvent = await dataSource.getRepository(VisitorGateEventEntity).save({
      id: randomUUID(),
      visitId: legacyVisit.id,
      operatorUserId: securityId,
      gateId,
      direction: 'IN',
      count: 18,
    });
    const oldPass = await service.visitorPass({
      visitId: legacyVisit.id,
      accessKey: registration.accessKey,
    });
    assert.equal(oldPass.visit.presence, 'NEEDS_REVIEW');
    assert.equal(oldPass.pass, null);
    const manualExit = {
      requestId: randomUUID(),
      representativeConfirmed: true as const,
      reviewNote: 'Representative verified all visitors have left',
    };
    await assert.rejects(
      service.manualVisitCheckout(siteManager, siteId, legacyVisit.id, manualExit),
    );
    const reconciled = await service.manualVisitCheckout(
      security,
      siteId,
      legacyVisit.id,
      manualExit,
    );
    assert.equal(reconciled.exitedCount, 18);
    assert.equal(reconciled.presence, 'OUTSIDE');
    await service.manualVisitCheckout(security, siteId, legacyVisit.id, manualExit);
    assert.equal(
      await dataSource.getRepository(GateEventEntity).countBy({ visitId: legacyVisit.id }),
      1,
    );
    assert.equal(
      (await dataSource.getRepository(VisitorGateEventEntity).findOneByOrFail({ id: oldEvent.id }))
        .count,
      18,
    );
    await dataSource
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await dataSource.getRepository(ContractorSiteParticipationEntity).save({
      id: participationId,
      contractorId,
      siteId,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: null,
      isActive: true,
    });
    await dataSource.getRepository(WorkerEntity).save({
      id: workerId,
      siteId,
      userId: accountId,
      contractorId,
      externalId: workerId,
      displayName: 'Synthetic worker',
      isActive: true,
    });
    await dataSource.getRepository(FaceProfileEntity).save({
      id: randomUUID(),
      workerId,
      userId: accountId,
      encryptedTemplate: 'gAAAA' + 'a'.repeat(150),
      profileReferenceHash: createHash('sha256').update(workerId).digest('hex'),
      modelVersion: 'synthetic-v1',
      status: FaceProfileStatus.ACTIVE,
      consentVersion: 'synthetic-v1',
      consentedAt: new Date(),
      createdByUserId: managerId,
    });
    await dataSource.getRepository(WorkerSiteZoneAssignmentEntity).save({
      id: assignmentId,
      workerId,
      siteId,
      siteContractorId: participationId,
      zoneIds: [randomUUID()],
      status: WorkerSiteZoneAssignmentStatus.APPROVED,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 3600_000),
      requestedByUserId: managerId,
      siteManagerDecidedByUserId: managerId,
    });
    const permissionId = randomUUID();
    await dataSource.getRepository(WorkerGatePermissionEntity).save({
      id: permissionId,
      workerAssignmentId: assignmentId,
      workerId,
      siteId,
      gateId,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: null,
      createdByUserId: managerId,
    });
    const fallback = await service.cameraFallback(security, siteId, gateId, {
      direction: 'IN',
      reason: 'CAMERA_UNAVAILABLE',
    });
    await assert.rejects(service.workerPass(security, siteId, { fallbackSessionId: fallback.id }));
    await assert.rejects(
      service.workerPass(workerActor, otherSiteId, { fallbackSessionId: fallback.id }),
    );
    const workerPass = await service.workerPass(workerActor, siteId, {
      fallbackSessionId: fallback.id,
    });
    const scan: VerifyWorkerQrCommand = {
      token: workerPass.token,
      direction: 'IN',
      requestId: randomUUID(),
    };
    await assert.rejects(service.workerGate(siteManager, siteId, gateId, scan)); // belongs to the opening operator
    await assert.rejects(
      service.workerGate(security, siteId, gateId, { ...scan, direction: 'OUT' }),
    );
    const workerResults = await Promise.all([
      service.workerGate(security, siteId, gateId, scan),
      service.workerGate(security, siteId, gateId, scan),
    ]);
    assert.equal(workerResults[0].authorization, 'ALLOWED');
    assert.equal(workerResults[0].log.method, 'QR');
    assert.equal(workerResults[0].log.id, workerResults[1].log.id);
    assert.equal(await dataSource.getRepository(GateAccessLogEntity).countBy({ workerId }), 1);
    const attempt = workerResults[0].attempt!;
    assert.equal(attempt.status, 'PENDING');
    assert.equal(await dataSource.getRepository(GateEventEntity).countBy({ workerId }), 0);
    await assert.rejects(
      service.confirmPassage(security, siteId, attempt.id, { idempotencyKey: randomUUID() }),
    );
    const confirm = {
      idempotencyKey: randomUUID(),
      reviewNote: 'Security verified unscheduled entry',
    };
    const passages = await Promise.all([
      service.confirmPassage(security, siteId, attempt.id, confirm),
      service.confirmPassage(security, siteId, attempt.id, confirm),
    ]);
    assert.equal(passages[0].id, passages[1].id);
    assert.equal(await dataSource.getRepository(GateEventEntity).countBy({ workerId }), 1);
    await assert.rejects(
      service.workerGate(security, siteId, gateId, { ...scan, requestId: randomUUID() }),
      /already been used/,
    );
    await assert.rejects(
      service.workerPass(workerActor, siteId, { fallbackSessionId: fallback.id }),
      /unavailable/,
    );
    const deniedFallback = await service.cameraFallback(security, siteId, gateId, {
      direction: 'IN',
      reason: 'CAMERA_UNAVAILABLE',
    });
    const deniedPass = await service.workerPass(workerActor, siteId, {
      fallbackSessionId: deniedFallback.id,
    });
    await dataSource
      .getRepository(WorkerGatePermissionEntity)
      .update(permissionId, { revokedAt: new Date(), revokedByUserId: managerId });
    assert.equal(
      (
        await service.workerGate(security, siteId, gateId, {
          token: deniedPass.token,
          direction: 'IN',
          requestId: randomUUID(),
        })
      ).authorization,
      'DENIED',
    );
    const staleSession = await service.cameraFallback(security, siteId, gateId, {
      direction: 'IN',
      reason: 'CAMERA_UNAVAILABLE',
    });
    const stalePass = await service.workerPass(workerActor, siteId, {
      fallbackSessionId: staleSession.id,
    });
    await dataSource
      .getRepository(QrFallbackSessionEntity)
      .update(staleSession.id, { expiresAt: new Date(Date.now() - 1) });
    await assert.rejects(
      service.workerGate(security, siteId, gateId, {
        token: stalePass.token,
        direction: 'IN',
        requestId: randomUUID(),
      }),
      /expired/,
    );
    const inactiveSession = await service.cameraFallback(security, siteId, gateId, {
      direction: 'IN',
      reason: 'CAMERA_UNAVAILABLE',
    });
    const inactivePass = await service.workerPass(workerActor, siteId, {
      fallbackSessionId: inactiveSession.id,
    });
    await dataSource.getRepository(UserEntity).update(accountId, { isActive: false });
    await assert.rejects(
      service.workerGate(security, siteId, gateId, {
        token: inactivePass.token,
        direction: 'IN',
        requestId: randomUUID(),
      }),
      /unavailable/,
    );
  } finally {
    await cleanupSiteAccess(dataSource, sites);
    await dataSource.query(
      'DELETE FROM qr_credential WHERE visit_id IN (SELECT id FROM visitor_visit WHERE site_id = ANY($1)) OR fallback_session_id IN (SELECT id FROM qr_fallback_session WHERE site_id = ANY($1))',
      [sites],
    );
    await dataSource.query(
      'DELETE FROM visitor_gate_event WHERE visit_id IN (SELECT id FROM visitor_visit WHERE site_id = ANY($1))',
      [sites],
    );
    const representatives = await dataSource.query<{ representative_visitor_id: string }[]>(
      'SELECT representative_visitor_id FROM visitor_visit WHERE site_id = ANY($1)',
      [sites],
    );
    await dataSource.query('DELETE FROM visitor_visit WHERE site_id = ANY($1)', [sites]);
    await dataSource.query('DELETE FROM visitor WHERE id = ANY($1)', [
      representatives.map((v) => v.representative_visitor_id),
    ]);
    await dataSource.query('DELETE FROM qr_fallback_session WHERE site_id = ANY($1)', [sites]);
    await dataSource.query('DELETE FROM gate_access_log WHERE site_id = ANY($1)', [sites]);
    await dataSource.query('DELETE FROM worker_gate_permission WHERE site_id = ANY($1)', [sites]);
    await dataSource.query('DELETE FROM face_profile WHERE worker_id = $1', [workerId]);
    await dataSource.query('DELETE FROM worker_site_zone_assignment WHERE worker_id = $1', [
      workerId,
    ]);
    await dataSource.query('DELETE FROM worker WHERE id = $1', [workerId]);
    await dataSource.query('DELETE FROM contractor_site_participation WHERE contractor_id = $1', [
      contractorId,
    ]);
    await dataSource.query('DELETE FROM contractor WHERE id = $1', [contractorId]);
    await dataSource.query('DELETE FROM app_user WHERE id = ANY($1)', [users]);
    await dataSource.query('DELETE FROM site WHERE id = ANY($1)', [sites]);
    await dataSource.destroy();
  }
});
