import { VisitorRoster1792022400000 } from '../../src/database/migrations/1792022400000-VisitorRoster.js';
import { VisitorEmailService } from '../../src/modules/workforce/access/visitor-email.service.js';
import type {
  VerifyVisitorQrCommand,
  VerifyWorkerQrCommand,
} from '../../src/modules/workforce/access/qr-access.commands.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { WorkerQrShortCodes1792454400000 } from '../../src/database/migrations/1792454400000-WorkerQrShortCodes.js';
import { QrAccessService } from '../../src/modules/workforce/access/qr-access.service.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
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
  QrCredentialEntity,
  GateAccessLogEntity,
  AttendanceEventEntity,
  AttendanceSessionEntity,
  WorkerScheduleEntity,
  UserNotificationEntity,
} from '../../src/database/entities/index.js';
import dataSource from '../support/test-data-source.js';
import { createTestConfig } from '../support/config.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import { assignTestShift } from '../support/assigned-shift.js';
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
  const service = new QrAccessService(dataSource, undefined, undefined, createTestConfig());
  const gateId = 'gate-north-01';
  const registration = {
    requestId: randomUUID(),
    accessKey: 'b'.repeat(64),
    visitorName: 'Synthetic representative',
    company: 'Synthetic group',
    contact: 'synthetic@example.test',
    email: 'synthetic@example.test',
    hostName: 'Synthetic host',
    purpose: 'Tour',
    targetArea: 'Office',
    groupSize: 20,
    members: Array.from({ length: 20 }, (_, i) => ({
      fullName: `Synthetic guest ${i}`,
      identityNumber: String(i + 1).padStart(12, '0'),
    })),
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
    await assert.rejects(
      service.register(siteId, { ...registration, members: [] }),
      /VISITOR_ROSTER_SIZE/,
    );
    const visit = await service.register(siteId, registration);
    assert.equal(visit.status, 'PENDING');
    assert.equal(visit.members?.length, 20);
    const downgrade = dataSource.createQueryRunner();
    await downgrade.connect();
    await downgrade.startTransaction();
    try {
      await assert.rejects(
        new VisitorRoster1792022400000().down(downgrade),
        /Visitor identity history/,
      );
    } finally {
      await downgrade.rollbackTransaction();
      await downgrade.release();
    }
    assert.equal('bookingCodeHash' in visit, false);
    assert.equal('bookingCodeCiphertext' in visit, false);
    assert.equal((await service.register(siteId, registration)).id, visit.id);
    await assert.rejects(
      service.register(siteId, { ...registration, visitorName: 'Changed' }),
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
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED'] as const)
      await assert.rejects(service.decideVisit(security, siteId, visit.id, { status }));
    assert.equal(
      (await service.listVisits(security, siteId)).items.some((item) => item.id === visit.id),
      true,
    );
    await assert.rejects(service.listVisits(security, otherSiteId));
    await assert.rejects(service.listVisitorEvents(security, otherSiteId));
    await service.decideVisit(siteManager, siteId, visit.id, { status: 'APPROVED' });
    const pass = (
      await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })
    ).pass!;
    assert.match(pass.token, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(pass.expiresAt, null);
    assert.equal(
      (await service.visitorPass({ visitId: visit.id, accessKey: registration.accessKey })).pass
        ?.token,
      pass.token,
    );
    const preview = await service.previewVisitorQr(security, siteId, gateId, { token: pass.token });
    assert.equal(preview.expiresAt, null);
    assert.equal(preview.direction, 'IN');
    await assert.rejects(
      service.previewVisitorQr(security, otherSiteId, gateId, { token: pass.token }),
    );
    await assert.rejects(
      service.previewVisitorQr(security, siteId, 'gate-west-02', { token: pass.token }),
    );
    const attendees = preview.visit
      .members!.slice(0, 18)
      .map((m) => ({ memberId: m.id, fullName: m.fullName, identityNumber: m.identityNumber }));
    attendees[0] = {
      ...attendees[0]!,
      fullName: 'Synthetic replacement',
      identityNumber: '900000000001',
    };
    const entry: VerifyVisitorQrCommand = {
      token: pass.token,
      direction: 'IN',
      requestId: randomUUID(),
      expectedVersion: preview.visit.version,
      attendees,
    };
    await assert.rejects(service.visitorGate(security, otherSiteId, gateId, entry));
    await assert.rejects(service.visitorGate(security, siteId, gateId, { ...entry, count: 21 }));
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, { ...entry, attendees: [] }),
    );
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, {
        ...entry,
        attendees: [attendees[0]!, attendees[0]!],
      }),
    );
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, {
        ...entry,
        attendees: [{ ...attendees[0]!, memberId: randomUUID() }],
      }),
    );
    const results = await Promise.all([
      service.visitorGate(security, siteId, gateId, entry),
      service.visitorGate(security, siteId, gateId, entry),
    ]);
    assert.equal(results[0].id, results[1].id);
    assert.equal(results[0].count, 18);
    assert.equal(results[0].visit.enteredCount, 18);
    assert.equal(results[0].visit.presence, 'INSIDE');
    assert.equal(results[0].attendees?.[0]?.replacedFrom?.fullName, 'Synthetic guest 0');
    assert.equal(results[0].visit.members?.filter((m) => m.inside).length, 18);
    assert.equal(results[0].visit.members?.[0]?.registeredFullName, 'Synthetic guest 0');
    assert.equal(
      await dataSource.getRepository(VisitorGateEventEntity).countBy({ visitId: visit.id }),
      1,
    );
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, { ...entry, requestId: randomUUID() }),
      /Reload/,
    );
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, { ...entry, attendees: attendees.slice(1) }),
      /different passage/,
    );
    assert.equal(
      (await service.listVisitorEvents(security, siteId)).items[0]?.attendees?.length,
      18,
    );
    assert.equal(
      (
        await service.listVisitorEvents(
          actor(otherManagerId, UserRole.SITE_MANAGER, otherSiteId),
          otherSiteId,
        )
      ).items.length,
      0,
    );
    const checkout = await service.previewVisitorQr(security, siteId, gateId, {
      token: pass.token,
    });
    assert.equal(checkout.direction, 'OUT');
    await assert.rejects(
      service.visitorGate(security, siteId, gateId, {
        ...entry,
        direction: 'OUT',
        expectedVersion: checkout.visit.version,
        requestId: randomUUID(),
        attendees: [{ ...attendees[0]!, fullName: 'Fabricated' }],
      }),
      /EXIT_IDENTITY/,
    );
    const exited = await service.visitorGate(security, siteId, gateId, {
      token: pass.token,
      direction: 'OUT',
      expectedVersion: checkout.visit.version,
      requestId: randomUUID(),
      attendees: attendees.slice(0, 5),
    });
    assert.equal(exited.visit.exitedCount, 5);
    await dataSource.getRepository(VisitorVisitEntity).update(visit.id, {
      validFrom: new Date(Date.now() - 120_000),
      validUntil: new Date(Date.now() - 60_000),
    });
    const departure = await service.previewVisitorQr(security, siteId, gateId, {
      token: pass.token,
    });
    const out = await service.visitorGate(security, siteId, gateId, {
      token: pass.token,
      direction: 'OUT',
      requestId: randomUUID(),
      expectedVersion: departure.visit.version,
      attendees: attendees.slice(5),
    });
    assert.equal(out.visit.presence, 'OUTSIDE');
    assert.equal(out.visit.exitedCount, 18);
    await assert.rejects(
      service.previewVisitorQr(security, siteId, gateId, { token: pass.token }),
      /schedule/,
    );
    assert.equal(
      (
        await dataSource
          .getRepository(VisitorGateEventEntity)
          .findOneByOrFail({ id: results[0].id })
      ).attendees[0]?.fullName,
      'Synthetic replacement',
    );
    // Single visitors retain a one-person passage using the same permanent code.
    const single = await service.register(siteId, {
      ...registration,
      requestId: randomUUID(),
      groupSize: 1,
      members: [],
    });
    await service.decideVisit(siteManager, siteId, single.id, { status: 'APPROVED' });
    const singlePass = (
      await service.visitorPass({ visitId: single.id, accessKey: registration.accessKey })
    ).pass!;
    const singleEntry = await service.visitorGate(security, siteId, gateId, {
      token: singlePass.token,
      direction: 'IN',
      requestId: randomUUID(),
    });
    assert.equal(singleEntry.count, 1);
    await service.visitorGate(security, siteId, gateId, {
      token: singlePass.token,
      direction: 'OUT',
      requestId: randomUUID(),
    });
    await service.decideVisit(siteManager, siteId, single.id, {
      status: 'CANCELLED',
      reviewNote: 'Changed plans',
    });
    await assert.rejects(
      service.previewVisitorQr(security, siteId, gateId, { token: singlePass.token }),
    );
    // Migration compatibility: earlier records without identities can still be reconciled.
    const legacy = await service.register(siteId, { ...registration, requestId: randomUUID() });
    await dataSource
      .getRepository(VisitorVisitEntity)
      .update(legacy.id, { members: [], enteredCount: 18 });
    const manual = {
      requestId: randomUUID(),
      representativeConfirmed: true as const,
      reviewNote: 'Representative verified departure',
    };
    await assert.rejects(service.manualVisitCheckout(siteManager, siteId, legacy.id, manual));
    const reconciled = await service.manualVisitCheckout(security, siteId, legacy.id, manual);
    assert.equal(reconciled.exitedCount, 18);
    await service.manualVisitCheckout(security, siteId, legacy.id, manual);
    assert.equal(
      await dataSource.getRepository(GateEventEntity).countBy({ visitId: legacy.id }),
      1,
    );
    const mailConfig = createTestConfig({
      RESEND_API_KEY: 're_synthetic_test_only',
      RESEND_FROM_EMAIL: 'qr@example.test',
    });
    const email = new VisitorEmailService(dataSource, mailConfig);
    const emailedAccess = new QrAccessService(dataSource, undefined, undefined, mailConfig, email);
    const emailVisit = await emailedAccess.register(siteId, {
      ...registration,
      requestId: randomUUID(),
      language: 'vi',
    });
    const originalFetch = globalThis.fetch;
    let deliveries = 0;
    const payloads: Array<Record<string, unknown>> = [];
    const deliveryKeys: string[] = [];
    let failNext = true;
    let holdNext: (() => Promise<Response>) | undefined;
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.resend.com/emails');
      deliveries++;
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      deliveryKeys.push(new Headers(init?.headers).get('Idempotency-Key')!);
      if (holdNext) {
        const held = holdNext;
        holdNext = undefined;
        return held();
      }
      if (failNext) {
        failNext = false;
        return new Response('{}', { status: 503 });
      }
      return Response.json({ id: randomUUID() });
    };
    try {
      const queued = await emailedAccess.decideVisit(siteManager, siteId, emailVisit.id, {
        status: 'APPROVED',
      });
      assert.equal(queued.emailStatus, 'PENDING');
      await assert.rejects(emailedAccess.retryVisitorEmail(security, siteId, emailVisit.id));
      await Promise.all([
        emailedAccess.retryVisitorEmail(siteManager, siteId, emailVisit.id),
        emailedAccess.retryVisitorEmail(siteManager, siteId, emailVisit.id),
      ]);
      assert.equal(deliveries, 2);
      assert.equal(
        (await dataSource.getRepository(VisitorVisitEntity).findOneByOrFail({ id: emailVisit.id }))
          .emailStatus,
        'SENT',
      );
      assert.match(String(payloads[1]?.subject), /phê duyệt/);
      assert.deepEqual(payloads[0], payloads[1]);
      assert.equal(payloads[1]?.from, 'SmartSite <qr@example.test>');
      assert.equal(
        (payloads[1]?.attachments as Array<{ filename: string }>)[0]?.filename,
        'smartsite-visitor-qr.png',
      );
      await email.deliver(emailVisit.id);
      assert.equal(deliveries, 2);
      assert.equal(deliveryKeys[0], `visitor-approved/${emailVisit.id}`);
      assert.equal(deliveryKeys[0], deliveryKeys[1]);

      const cancellation = { status: 'CANCELLED' as const, reviewNote: 'Host unavailable' };
      const cancelled = await emailedAccess.decideVisit(
        siteManager,
        siteId,
        emailVisit.id,
        cancellation,
      );
      assert.equal(cancelled.emailStatus, 'SENT');
      assert.match(String(payloads[2]?.subject), /hủy/);
      assert.match(String(payloads[2]?.text), /Host unavailable/);
      assert.equal(payloads[2]?.attachments, undefined);
      assert.equal(deliveryKeys[2], `visitor-cancelled/${emailVisit.id}`);
      assert.equal(
        (await dataSource.getRepository(VisitorVisitEntity).findOneByOrFail({ id: emailVisit.id }))
          .emailAttempts,
        1,
      );
      await emailedAccess.decideVisit(siteManager, siteId, emailVisit.id, cancellation);
      await emailedAccess.retryVisitorEmail(siteManager, siteId, emailVisit.id);
      assert.equal(deliveries, 3);

      const rejectedVisit = await emailedAccess.register(siteId, {
        ...registration,
        requestId: randomUUID(),
        language: 'en',
      });
      failNext = true;
      const rejected = await emailedAccess.decideVisit(siteManager, siteId, rejectedVisit.id, {
        status: 'REJECTED',
        reviewNote: '<Area closed>',
      });
      assert.equal(rejected.emailStatus, 'PENDING');
      await assert.rejects(emailedAccess.retryVisitorEmail(security, siteId, rejectedVisit.id));
      await assert.rejects(
        emailedAccess.retryVisitorEmail(siteManager, otherSiteId, rejectedVisit.id),
      );
      const retried = await emailedAccess.retryVisitorEmail(siteManager, siteId, rejectedVisit.id);
      assert.equal(retried.emailStatus, 'SENT');
      assert.equal(deliveries, 5);
      assert.match(String(payloads[4]?.subject), /rejected/);
      assert.match(String(payloads[4]?.html), /&lt;Area closed&gt;/);
      assert.equal(payloads[4]?.attachments, undefined);
      assert.deepEqual(payloads[3], payloads[4]);
      assert.equal(deliveryKeys[3], `visitor-rejected/${rejectedVisit.id}`);
      assert.equal(deliveryKeys[3], deliveryKeys[4]);

      // An approval already in flight must not overwrite the cancellation email's result.
      const racingVisit = await emailedAccess.register(siteId, {
        ...registration,
        requestId: randomUUID(),
      });
      let started!: () => void;
      let release!: (response: Response) => void;
      const sending = new Promise<void>((resolve) => {
        started = resolve;
      });
      holdNext = () =>
        new Promise<Response>((resolve) => {
          release = resolve;
          started();
        });
      const approval = emailedAccess.decideVisit(siteManager, siteId, racingVisit.id, {
        status: 'APPROVED',
      });
      await sending;
      try {
        await emailedAccess.decideVisit(siteManager, siteId, racingVisit.id, cancellation);
      } finally {
        release(new Response('{}', { status: 503 }));
        await approval;
      }
      const current = await dataSource
        .getRepository(VisitorVisitEntity)
        .findOneByOrFail({ id: racingVisit.id });
      assert.equal(current.status, 'CANCELLED');
      assert.equal(current.emailStatus, 'SENT');
      assert.equal(current.emailAttempts, 1);
      assert.equal(current.emailNextAttemptAt, null);

      // Recover a stale cancellation lease after a process restart without a booking code.
      await dataSource.getRepository(VisitorVisitEntity).update(rejectedVisit.id, {
        status: 'CANCELLED',
        emailStatus: 'SENDING',
        emailAttemptedAt: new Date(Date.now() - 6 * 60_000),
        emailNextAttemptAt: null,
      });
      await Promise.all([email.deliver(rejectedVisit.id), email.deliver(rejectedVisit.id)]);
      assert.equal(deliveries, 8);
      assert.match(String(payloads[7]?.subject), /cancelled/);
      assert.equal(payloads[7]?.attachments, undefined);
      await email.deliver(rejectedVisit.id);
      assert.equal(deliveries, 8);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
    const noShiftFallback = await service.cameraFallback(security, siteId, gateId, {
      direction: 'IN',
      reason: 'CAMERA_UNAVAILABLE',
    });
    const noShiftPass = await service.workerPass(workerActor, siteId, {
      fallbackSessionId: noShiftFallback.id,
    });
    const noShiftScan = {
      token: noShiftPass.token,
      direction: 'IN' as const,
      requestId: randomUUID(),
    };
    const deniedResults = await Promise.all([
      service.workerGate(security, siteId, gateId, noShiftScan),
      service.workerGate(security, siteId, gateId, noShiftScan),
    ]);
    assert.equal(deniedResults[0].reasonCode, 'NO_SCHEDULE');
    assert.equal(deniedResults[0].authorization, 'DENIED');
    assert.equal(deniedResults[0].attempt?.status, 'DENIED');
    assert.equal(deniedResults[0].attempt?.id, deniedResults[1].attempt?.id);
    await assert.rejects(
      service.confirmPassage(security, siteId, deniedResults[0].attempt!.id, {
        idempotencyKey: randomUUID(),
        reviewNote: 'Security cannot bypass a missing shift',
      }),
      (e: unknown) =>
        e instanceof PublicHttpException && e.publicPayload.code === 'WORKER_NO_SCHEDULE',
    );
    assert.equal(await dataSource.getRepository(GateEventEntity).countBy({ workerId }), 0);
    assert.equal(await dataSource.getRepository(AttendanceEventEntity).countBy({ workerId }), 0);
    assert.equal(
      await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ recipientUserId: accountId, event: 'ENTRY_DENIED_NO_SCHEDULE' }),
      1,
    );
    const assigned = await assignTestShift(dataSource, siteId, workerId);
    const staleAttempt = await service.manualWorker(security, siteId, gateId, {
      requestId: randomUUID(),
      workerId,
      direction: 'IN',
      identityConfirmed: true,
      reviewNote: 'Synthetic verification before schedule change',
    });
    await dataSource.getRepository(WorkerScheduleEntity).update(assigned.id, { isActive: false });
    await assert.rejects(
      service.confirmPassage(security, siteId, staleAttempt.id, {
        idempotencyKey: randomUUID(),
        reviewNote: 'Cannot override a removed schedule',
      }),
      (e: unknown) =>
        e instanceof PublicHttpException && e.publicPayload.code === 'WORKER_NO_SCHEDULE',
    );
    assert.equal(
      await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ recipientUserId: accountId, event: 'ENTRY_DENIED_NO_SCHEDULE' }),
      1,
    );
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await dataSource
      .getRepository(WorkerScheduleEntity)
      .update(assigned.id, { isActive: true, workDate: yesterday });
    const historical = await service.manualWorker(security, siteId, gateId, {
      requestId: randomUUID(),
      workerId,
      direction: 'IN',
      identityConfirmed: true,
      reviewNote: 'Old assigned shift does not count today',
    });
    assert.equal(historical.status, 'DENIED');
    assert.equal(historical.scheduleStatus, 'NO_SCHEDULE');
    await dataSource
      .getRepository(WorkerScheduleEntity)
      .update(assigned.id, { workDate: assigned.workDate });
    // A Worker already has its own credential before an officer opens fallback.
    const independentPass = await service.workerPass(workerActor, siteId, { direction: 'IN' });
    assert.match(independentPass.token, /^[A-HJ-NP-Z2-9]{8}$/);
    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await new WorkerQrShortCodes1792454400000().down(manager.queryRunner!);
      }),
      /Worker QR history requires/,
    );
    const fallback = await service.cameraFallback(security, siteId, gateId, {
      direction: 'IN',
      reason: 'CAMERA_UNAVAILABLE',
    });
    await assert.rejects(service.workerPass(security, siteId, { direction: 'IN' }));
    await assert.rejects(service.workerPass(workerActor, otherSiteId, { direction: 'IN' }));
    await assert.rejects(
      service.workerPass({ ...workerActor, roleAssignments: [] }, siteId, { direction: 'IN' }),
    );
    await assert.rejects(service.workerPass(workerActor, siteId, {}), /Choose a passage direction/);
    await assert.rejects(
      service.workerPass(workerActor, siteId, { direction: 'IN', fallbackSessionId: fallback.id }),
      /Choose a passage direction/,
    );
    // UUID-based clients remain compatible; the current mobile does not request an officer code.
    const previousPass = await service.workerPass(workerActor, siteId, {
      fallbackSessionId: fallback.id,
    });
    const workerPass = await service.workerPass(workerActor, siteId, { direction: 'IN' });
    assert.match(workerPass.token, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.notEqual(workerPass.token, previousPass.token);
    const storedPass = await dataSource
      .getRepository(QrCredentialEntity)
      .findOneByOrFail({ tokenHash: createHash('sha256').update(workerPass.token).digest('hex') });
    assert.equal(storedPass.fallbackSessionId, null);
    assert.equal(storedPass.siteId, siteId);
    assert.equal(storedPass.direction, 'IN');
    assert.ok(Date.parse(workerPass.expiresAt!) > Date.now());
    assert.ok(Date.parse(workerPass.expiresAt!) <= Date.now() + 300_000);
    const previousCredential = await dataSource.getRepository(QrCredentialEntity).findOneByOrFail({
      tokenHash: createHash('sha256').update(previousPass.token).digest('hex'),
    });
    assert.ok(previousCredential.revokedAt);
    await assert.rejects(
      service.workerGate(security, siteId, gateId, {
        token: previousPass.token,
        direction: 'IN',
        requestId: randomUUID(),
      }),
      /expired or been revoked/,
    );
    await assert.rejects(
      service.workerGate(security, siteId, gateId, {
        token: workerPass.token,
        direction: 'IN',
        requestId: randomUUID(),
      }),
      /Security must open/,
    );
    const scan: VerifyWorkerQrCommand = {
      token: workerPass.token.toLowerCase(),
      fallbackSessionId: fallback.id,
      direction: 'IN',
      requestId: randomUUID(),
    };
    await assert.rejects(service.workerGate(siteManager, siteId, gateId, scan)); // belongs to the opening operator
    await assert.rejects(
      service.workerGate(actor(managerId, UserRole.SECURITY_OFFICER), siteId, gateId, scan),
      /does not belong/,
    );
    await assert.rejects(
      service.workerGate(security, siteId, 'gate-west-02', scan),
      /does not belong/,
    );
    await assert.rejects(service.workerGate(security, otherSiteId, gateId, scan));
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
    assert.equal(await dataSource.getRepository(GateAccessLogEntity).countBy({ workerId }), 2);
    const attempt = workerResults[0].attempt!;
    assert.equal(attempt.status, 'READY');
    assert.equal(await dataSource.getRepository(GateEventEntity).countBy({ workerId }), 0);
    const confirm = {
      idempotencyKey: randomUUID(),
      reviewNote: 'Security verified scheduled entry',
    };
    const passages = await Promise.all([
      service.confirmPassage(security, siteId, attempt.id, confirm),
      service.confirmPassage(security, siteId, attempt.id, confirm),
    ]);
    assert.equal(passages[0].id, passages[1].id);
    assert.equal(await dataSource.getRepository(GateEventEntity).countBy({ workerId }), 1);
    const newAttempt = (
      direction: 'IN' | 'OUT',
      method: 'FACE' | 'QR' = 'FACE',
      operator = security,
    ) =>
      dataSource.transaction((manager) =>
        service.recordAttempt(manager, {
          actor: operator,
          siteId,
          gateId,
          direction,
          method,
          workerId,
          identityStatus: 'MATCHED',
          authorization: 'ALLOWED',
          reasonCode: 'SYNTHETIC_VERIFIED',
          scheduleStatus: 'SCHEDULED',
        }),
      );
    const repeated = await Promise.all(Array.from({ length: 5 }, () => newAttempt('IN')));
    const rawCount = await dataSource.getRepository(AttendanceEventEntity).countBy({ workerId });
    const sessionCount = await dataSource
      .getRepository(AttendanceSessionEntity)
      .countBy({ workerId });
    for (const attempt of repeated) {
      await assert.rejects(
        service.confirmPassage(security, siteId, attempt.id, {
          idempotencyKey: randomUUID(),
          reviewNote: 'Repeated camera scan',
        }),
        /Already checked in/,
      );
    }
    assert.equal(await dataSource.getRepository(GateEventEntity).countBy({ workerId }), 1);
    assert.equal(
      await dataSource.getRepository(AttendanceEventEntity).countBy({ workerId }),
      rawCount,
    );
    assert.equal(
      await dataSource.getRepository(AttendanceSessionEntity).countBy({ workerId }),
      sessionCount,
    );
    const managerRepeat = await newAttempt('IN', 'FACE', siteManager);
    await assert.rejects(
      service.confirmPassage(siteManager, siteId, managerRepeat.id, {
        idempotencyKey: randomUUID(),
        separatePassage: true,
        reviewNote: 'Manager cannot override repeated passage',
      }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
    );
    for (const denied of [
      workerActor,
      actor(securityId, UserRole.SECURITY_OFFICER, otherSiteId),
      { ...security, roleAssignments: [] },
    ]) {
      await assert.rejects(
        service.confirmPassage(denied, siteId, repeated[0]!.id, {
          idempotencyKey: randomUUID(),
          separatePassage: true,
          reviewNote: 'Cannot bypass scope',
        }),
        (error: unknown) =>
          error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
      );
    }
    await assert.rejects(
      service.confirmPassage(security, siteId, repeated[0]!.id, {
        idempotencyKey: randomUUID(),
        separatePassage: true,
      }),
      /reason/,
    );
    const distinct = await service.confirmPassage(security, siteId, repeated[0]!.id, {
      idempotencyKey: randomUUID(),
      separatePassage: true,
      reviewNote: 'Security confirmed a real second entry with missing exit',
    });
    assert.equal(distinct.direction, 'IN');
    assert.equal(
      await dataSource
        .getRepository(AttendanceSessionEntity)
        .countBy({ workerId, status: 'NEEDS_REVIEW' }),
      1,
    );
    const simultaneousExits = await Promise.all([newAttempt('OUT'), newAttempt('OUT', 'QR')]);
    const exitResults = await Promise.allSettled(
      simultaneousExits.map((candidate) =>
        service.confirmPassage(security, siteId, candidate.id, { idempotencyKey: randomUUID() }),
      ),
    );
    assert.equal(exitResults.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(exitResults.filter((result) => result.status === 'rejected').length, 1);
    const repeatedOut = await newAttempt('OUT', 'QR');
    await assert.rejects(
      service.confirmPassage(security, siteId, repeatedOut.id, { idempotencyKey: randomUUID() }),
      /Already checked out/,
    );
    const returned = await newAttempt('IN');
    await service.confirmPassage(security, siteId, returned.id, {
      idempotencyKey: randomUUID(),
      reviewNote: 'Worker returned after the recorded exit',
    });
    assert.equal(await dataSource.getRepository(GateEventEntity).countBy({ workerId }), 4);
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
    await dataSource.query('DELETE FROM worker_schedule WHERE site_id=$1', [siteId]);
    await dataSource.query('DELETE FROM shift WHERE site_id=$1', [siteId]);
    await dataSource.query('DELETE FROM schedule_version WHERE site_id=$1', [siteId]);
    await dataSource.query('DELETE FROM qr_credential WHERE site_id = ANY($1)', [sites]);
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
