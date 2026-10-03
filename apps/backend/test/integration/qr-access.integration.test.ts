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
  VisitorVisitEntity,
  VisitorGateEventEntity,
  QrFallbackSessionEntity,
  GateAccessLogEntity,
} from '../../src/database/entities/index.js';
import dataSource from '../support/test-data-source.js';
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
      count: 18,
      requestId: randomUUID(),
    };
    await assert.rejects(service.visitorGate(security, otherSiteId, gateId, entry));
    await assert.rejects(service.visitorGate(security, siteId, 'gate-west-02', entry));
    const concurrent = await Promise.all([
      service.visitorGate(security, siteId, gateId, entry),
      service.visitorGate(security, siteId, gateId, entry),
    ]);
    assert.equal(concurrent[0].id, concurrent[1].id);
    assert.equal(concurrent[0].visit.enteredCount, 18);
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
      /exceeds/,
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
      count: 15,
      requestId: randomUUID(),
    });
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
      /schedule/,
    );
    await service.visitorGate(security, siteId, gateId, {
      token: departure.token,
      direction: 'OUT',
      count: 3,
      requestId: randomUUID(),
    });
    assert.equal(
      (await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })).pass,
      null,
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
    await dataSource
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await dataSource.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
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
    const permissionId = randomUUID();
    await dataSource.getRepository(WorkerGatePermissionEntity).save({
      id: permissionId,
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
    await dataSource.query(
      'DELETE FROM qr_credential WHERE visit_id IN (SELECT id FROM visitor_visit WHERE site_id = ANY($1)) OR fallback_session_id IN (SELECT id FROM qr_fallback_session WHERE site_id = ANY($1))',
      [sites],
    );
    await dataSource.query(
      'DELETE FROM visitor_gate_event WHERE visit_id IN (SELECT id FROM visitor_visit WHERE site_id = ANY($1))',
      [sites],
    );
    await dataSource.query('DELETE FROM visitor_visit WHERE site_id = ANY($1)', [sites]);
    await dataSource.query('DELETE FROM qr_fallback_session WHERE site_id = ANY($1)', [sites]);
    await dataSource.query('DELETE FROM gate_access_log WHERE site_id = ANY($1)', [sites]);
    await dataSource.query('DELETE FROM worker_gate_permission WHERE site_id = ANY($1)', [sites]);
    await dataSource.query('DELETE FROM face_profile WHERE worker_id = $1', [workerId]);
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
