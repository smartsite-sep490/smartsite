import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { FaceEnrollmentService } from '../../src/modules/workforce/identity/face-enrollment.service.js';
import { FaceEnrollmentController } from '../../src/modules/workforce/identity/face-enrollment.controller.js';
import { FaceGateService } from '../../src/modules/workforce/access/face-gate.service.js';
import { WorkerGatePermissionsService } from '../../src/modules/workforce/access/worker-gate-permissions.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import {
  AccessAuditEntity,
  ContractorEntity,
  ContractorRepresentativeGrantEntity,
  ContractorSiteParticipationEntity,
  FaceEnrollmentSessionEntity,
  FaceEnrollmentSessionStatus,
  FaceProfileEntity,
  GateAccessLogEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerGatePermissionEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../../src/database/entities/index.js';
import type { FaceVerificationInput } from '../../src/modules/workforce/identity/face-enrollment.adapter.js';
import type { FaceVerificationTechnicalOutcome } from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { assignTestShift } from '../support/assigned-shift.js';

const database = createIsolatedTestDatabase({ canonical: true });
const { dataSource } = database;
before(() => database.initialize());
after(() => database.dispose());

test('registered entity columns exist in the canonical migrated schema', async () => {
  const [{ owned_schema: ownedSchema }] = (await dataSource.query(
    'SELECT current_schema() AS owned_schema',
  )) as [{ owned_schema: string }];
  assert.match(ownedSchema, /^isolated_test_[0-9a-f]{32}$/);
  const installedMigrations = (await dataSource.query('SELECT name FROM migrations')) as Array<{
    name: string;
  }>;
  assert.equal(dataSource.migrations.length, 56);
  assert.deepEqual(
    installedMigrations.map((migration) => migration.name).sort(),
    dataSource.migrations.map((migration) => migration.name ?? migration.constructor.name).sort(),
  );
  const actualColumns = (await dataSource.query(
    'SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=current_schema()',
  )) as Array<{ table_name: string; column_name: string }>;
  const columns = new Set(actualColumns.map((row) => `${row.table_name}.${row.column_name}`));
  const missing: string[] = [];
  for (const entity of dataSource.entityMetadatas) {
    for (const column of entity.columns) {
      if (column.isVirtual) continue;
      const qualified = `${entity.tableName}.${column.databaseName}`;
      if (!columns.has(qualified)) missing.push(qualified);
    }
  }
  assert.deepEqual(
    missing.sort(),
    [],
    'Canonical ORM metadata must not require branch-only columns',
  );
});

test('account linking, encrypted DB enrollment, scoped matching and revocation', async () => {
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const accountId = randomUUID();
  const actorId = randomUUID();
  const siteManagerId = randomUUID();
  const otherSiteManagerId = randomUUID();
  const securityOfficerId = randomUUID();
  const otherSecurityOfficerId = randomUUID();
  const contractorRepId = randomUUID();
  const unassignedUserId = randomUUID();
  const workerId = randomUUID();
  const secondWorkerId = randomUUID();
  const contractorId = randomUUID();
  const participationId = randomUUID();
  const assignmentId = randomUUID();

  const actor = {
    id: actorId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  const workerActor = {
    id: accountId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.WORKER, siteId }],
  };
  const forbiddenEnrollment = (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), 403);
    return true;
  };
  const siteManagerActor = {
    id: siteManagerId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  };
  const otherSiteManagerActor = {
    id: otherSiteManagerId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: otherSiteId }],
  };
  const securityOfficerActor = {
    id: securityOfficerId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId }],
  };
  const otherSecurityOfficerActor = {
    id: otherSecurityOfficerId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: otherSiteId }],
  };
  const contractorRepActor = {
    id: contractorRepId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
  };

  const cipher = 'gAAAA' + 'a'.repeat(150) + '=='; // synthetic ciphertext; no real biometric data
  let reference = '';
  let verification: FaceVerificationInput | undefined;
  let technicalStatus: FaceVerificationTechnicalOutcome = 'MATCHED';
  let failNextComplete = false;

  const adapter = {
    async assessSampleQuality() {
      return { status: 'ACCEPTED' as const };
    },
    async submitSample(input: { sampleIndex: number }) {
      return { acceptedSampleCount: input.sampleIndex };
    },
    async completeEnrollment(sessionId: string) {
      if (failNextComplete) {
        failNextComplete = false;
        throw new Error('Synthetic adapter enrollment completion failure');
      }
      reference = `fp_${sessionId.replaceAll('-', '')}`;
      return {
        profileReference: reference,
        modelVersion: 'synthetic-v1',
        encryptedTemplate: cipher,
      };
    },
    async verify(input: FaceVerificationInput) {
      if (input.gatePresenceSession) {
        verification = input;
        return { status: 'UNKNOWN' as const, reasonCode: 'FACE_PRESENCE_NEW' };
      }
      verification = input;
      if (technicalStatus !== 'MATCHED') return { status: technicalStatus };
      return {
        status: 'MATCHED' as const,
        candidateProfileReference: reference,
        modelVersion: 'synthetic-v1',
        scoreBand: 'HIGH' as const,
      };
    },
  };

  for (const id of [siteId, otherSiteId]) {
    await dataSource.getRepository(SiteEntity).save({ id, code: id, name: 'Synthetic site' });
  }
  for (const id of [
    accountId,
    actorId,
    siteManagerId,
    otherSiteManagerId,
    securityOfficerId,
    otherSecurityOfficerId,
    contractorRepId,
    unassignedUserId,
  ]) {
    await dataSource.getRepository(UserEntity).save({
      id,
      username: id,
      displayName: 'Synthetic user',
      passwordHash: 'synthetic-not-a-login-hash',
      isActive: true,
      mustChangePassword: false,
    });
  }
  await dataSource.getRepository(UserRoleAssignmentEntity).save([
    { id: randomUUID(), userId: actorId, role: UserRole.ADMIN, siteId: null },
    { id: randomUUID(), userId: accountId, role: UserRole.WORKER, siteId },
    { id: randomUUID(), userId: siteManagerId, role: UserRole.SITE_MANAGER, siteId },
    {
      id: randomUUID(),
      userId: otherSiteManagerId,
      role: UserRole.SITE_MANAGER,
      siteId: otherSiteId,
    },
    { id: randomUUID(), userId: securityOfficerId, role: UserRole.SECURITY_OFFICER, siteId },
    {
      id: randomUUID(),
      userId: otherSecurityOfficerId,
      role: UserRole.SECURITY_OFFICER,
      siteId: otherSiteId,
    },
    {
      id: randomUUID(),
      userId: contractorRepId,
      role: UserRole.CONTRACTOR_REPRESENTATIVE,
      siteId,
    },
  ]);

  for (const id of [workerId, secondWorkerId]) {
    await dataSource
      .getRepository(WorkerEntity)
      .save({ id, siteId, externalId: id, displayName: 'Synthetic worker', isActive: true });
  }

  const workforce = new WorkforceConfigurationService(dataSource);
  const prepared = await Promise.all([
    workforce.forAccount(siteId, { userId: accountId }),
    workforce.forAccount(siteId, { userId: accountId }),
  ]);
  assert.equal(prepared[0]!.id, prepared[1]!.id);
  assert.equal(prepared[0]!.userId, accountId);
  await dataSource.getRepository(WorkerEntity).delete(prepared[0]!.id);
  await assert.rejects(workforce.forAccount(siteId, { userId: randomUUID() }));

  const enrollment = new FaceEnrollmentService(
    dataSource,
    new ContractorOperationsService(dataSource),
    adapter,
  );

  // Unlinked worker enrollment, consent, quality, cancellation, failure rollback, and renewal
  const unlinkedSession = await enrollment.start(actor, secondWorkerId, {
    consentVersion: 'synthetic-v1',
  });
  assert.equal(unlinkedSession.consentedAt, null);
  assert.equal(unlinkedSession.status, FaceEnrollmentSessionStatus.PENDING);
  assert.equal(unlinkedSession.consentMethod, null);

  const sample = { mimetype: 'image/jpeg', buffer: Buffer.from('synthetic-jpeg'), size: 14 };
  await assert.rejects(
    enrollment.submitSample(actor, unlinkedSession.id, sample),
    /confirm consent/,
  );
  await assert.rejects(
    enrollment.assessSampleQuality(actor, secondWorkerId, sample, 'front'),
    /Worker consent is required before face quality assessment/,
  );
  await assert.rejects(
    enrollment.confirmConsent(unlinkedSession.id, {
      consentToken: 'f'.repeat(64),
      workerConfirmed: true,
    }),
  );
  const consentedUnlinkedSession = await enrollment.confirmConsent(unlinkedSession.id, {
    consentToken: unlinkedSession.consentToken,
    workerConfirmed: true,
  });
  assert.equal(consentedUnlinkedSession.status, FaceEnrollmentSessionStatus.PENDING);
  assert.notEqual(consentedUnlinkedSession.consentedAt, null);
  assert.equal(consentedUnlinkedSession.consentMethod, 'SUPERVISED_WORKER_CONFIRMATION');

  const qualityAccepted = await enrollment.assessSampleQuality(
    actor,
    secondWorkerId,
    sample,
    'front',
  );
  assert.equal(qualityAccepted.status, 'ACCEPTED');
  await assert.rejects(
    enrollment.assessSampleQuality(actor, secondWorkerId, sample, 'INVALID' as 'front'),
    /Invalid face capture target/,
  );

  // Cannot complete before 3 accepted samples, and wrong actor cannot hijack session
  const collectingSession = await enrollment.submitSample(actor, unlinkedSession.id, sample);
  assert.equal(collectingSession.status, FaceEnrollmentSessionStatus.COLLECTING);
  assert.equal(collectingSession.acceptedSampleCount, 1);
  await assert.rejects(enrollment.complete(actor, unlinkedSession.id), /three accepted samples/);
  await assert.rejects(enrollment.submitSample(siteManagerActor, unlinkedSession.id, sample));
  await enrollment.submitSample(actor, unlinkedSession.id, sample);
  await enrollment.submitSample(actor, unlinkedSession.id, sample);

  const unlinkedProfile = await enrollment.complete(actor, unlinkedSession.id);
  assert.equal(unlinkedProfile.userId, null);
  assert.equal(unlinkedProfile.status, 'ACTIVE');
  assert.equal(unlinkedProfile.consentMethod, 'SUPERVISED_WORKER_CONFIRMATION');

  await enrollment.revokeProfile(actor, secondWorkerId, true);
  assert.equal((await enrollment.getProfile(actor, secondWorkerId)).status, 'DELETED');

  const cancelledSession = await enrollment.start(actor, secondWorkerId, {
    consentVersion: 'synthetic-v2',
  });
  await enrollment.cancel(actor, cancelledSession.id);
  await assert.rejects(
    enrollment.confirmConsent(cancelledSession.id, {
      consentToken: cancelledSession.consentToken,
      workerConfirmed: true,
    }),
    /unavailable/,
  );

  // Adapter completion failure marks session FAILED without activating a profile
  const failedSession = await enrollment.start(actor, secondWorkerId, {
    consentVersion: 'synthetic-v2',
  });
  await enrollment.confirmConsent(failedSession.id, {
    consentToken: failedSession.consentToken,
    workerConfirmed: true,
  });
  for (let i = 0; i < 3; i++) await enrollment.submitSample(actor, failedSession.id, sample);
  failNextComplete = true;
  await assert.rejects(enrollment.complete(actor, failedSession.id), /completion failure/);
  const failedSessionRow = await dataSource
    .getRepository(FaceEnrollmentSessionEntity)
    .findOneByOrFail({ id: failedSession.id });
  assert.equal(failedSessionRow.status, 'FAILED');

  const renewedSession = await enrollment.start(actor, secondWorkerId, {
    consentVersion: 'synthetic-v2',
  });
  await enrollment.confirmConsent(renewedSession.id, {
    consentToken: renewedSession.consentToken,
    workerConfirmed: true,
  });
  for (let i = 0; i < 3; i++) await enrollment.submitSample(actor, renewedSession.id, sample);
  const renewedProfile = await enrollment.complete(actor, renewedSession.id);
  assert.notEqual(renewedProfile.id, unlinkedProfile.id);
  assert.equal((await enrollment.getProfile(actor, secondWorkerId)).id, renewedProfile.id);
  assert.equal(
    (await dataSource.getRepository(FaceProfileEntity).findOneByOrFail({ id: unlinkedProfile.id }))
      .status,
    'DELETED',
  );
  assert.equal(
    await dataSource
      .getRepository(FaceProfileEntity)
      .countBy({ workerId: secondWorkerId, status: renewedProfile.status }),
    1,
  );
  await enrollment.revokeProfile(actor, secondWorkerId, true);

  // Linked account validation on start when worker.userId points to an unassigned account
  await dataSource.getRepository(WorkerEntity).update(workerId, { userId: unassignedUserId });
  await assert.rejects(
    enrollment.start(actor, workerId, { consentVersion: 'synthetic-v1' }),
    /linked account must be active and assigned to this site/,
  );
  await dataSource.getRepository(WorkerEntity).update(workerId, { userId: null });

  await assert.rejects(workforce.linkAccount(otherSiteId, workerId, { userId: accountId }));
  await assert.rejects(
    workforce.linkAccount(siteId, workerId, { userId: unassignedUserId }),
    /account assigned/,
  );
  await workforce.linkAccount(siteId, workerId, { userId: accountId });
  assert.equal((await workforce.forAccount(siteId, { userId: accountId })).id, workerId);
  await assert.rejects(workforce.forAccount(otherSiteId, { userId: accountId }));
  await workforce.linkAccount(siteId, workerId, { userId: accountId }); // idempotent
  await assert.rejects(workforce.linkAccount(siteId, secondWorkerId, { userId: accountId }));

  // Main allows an active account-linked Worker to enroll themselves at their assigned Site.
  // It does not allow that Worker to operate another Worker's enrollment or bypass initial password change.
  const selfSession = await enrollment.start(workerActor, workerId, {
    consentVersion: 'synthetic-self-v1',
  });
  assert.equal(selfSession.workerId, workerId);
  assert.equal(selfSession.actorUserId, workerActor.id);
  assert.equal(selfSession.status, FaceEnrollmentSessionStatus.PENDING);
  assert.equal(selfSession.consentedAt, null);
  assert.equal(selfSession.consentMethod, null);
  await assert.rejects(
    enrollment.start(workerActor, secondWorkerId, { consentVersion: 'synthetic-v1' }),
    forbiddenEnrollment,
  );
  await assert.rejects(
    enrollment.start(
      { ...workerActor, roleAssignments: [{ role: UserRole.WORKER, siteId: otherSiteId }] },
      workerId,
      { consentVersion: 'synthetic-v1' },
    ),
    forbiddenEnrollment,
  );
  await assert.rejects(
    enrollment.start({ ...workerActor, mustChangePassword: true }, workerId, {
      consentVersion: 'synthetic-v1',
    }),
    forbiddenEnrollment,
  );
  await enrollment.cancel(workerActor, selfSession.id);

  const session = await enrollment.start(actor, workerId, { consentVersion: 'synthetic-v1' });
  await enrollment.confirmConsent(session.id, {
    consentToken: session.consentToken,
    workerConfirmed: true,
  });
  const frame = { mimetype: 'image/jpeg', buffer: Buffer.from('synthetic-jpeg'), size: 14 };
  for (let index = 0; index < 3; index++) await enrollment.submitSample(actor, session.id, frame);
  const profile = await enrollment.complete(actor, session.id);
  assert.equal(profile.userId, accountId);

  const response = await new FaceEnrollmentController(enrollment).getProfile(
    { user: actor } as never,
    workerId,
  );
  assert.equal(response.userId, accountId);
  assert.equal('encryptedTemplate' in response, false);
  assert.equal((await enrollment.getProfile(workerActor, workerId)).id, profile.id);
  await assert.rejects(enrollment.revokeProfile(workerActor, secondWorkerId), forbiddenEnrollment);
  assert.equal(profile.profileReferenceHash, createHash('sha256').update(reference).digest('hex'));
  const stored = await dataSource
    .getRepository(FaceProfileEntity)
    .createQueryBuilder('profile')
    .addSelect('profile.encryptedTemplate')
    .where('profile.id = :id', { id: profile.id })
    .getOneOrFail();
  assert.equal(stored.encryptedTemplate, cipher);
  const publicLoad = await dataSource
    .getRepository(FaceProfileEntity)
    .findOneByOrFail({ id: profile.id });
  assert.equal(publicLoad.encryptedTemplate, undefined);

  // Canonical SafetyFaceProvenance1791590400003 & AccessAuditEntity provenance checks
  const consentAuditKey = {
    action: 'WORKER_FACE_CONSENT_CONFIRMED',
    entityId: session.id,
  };
  const consentAuditCount = await dataSource
    .getRepository(AccessAuditEntity)
    .countBy(consentAuditKey);
  assert.equal(consentAuditCount, 1);
  const consentAudit = await dataSource
    .getRepository(AccessAuditEntity)
    .findOneByOrFail(consentAuditKey);
  // Main records personal confirmation separately from an authenticated operator's activation.
  assert.equal(consentAudit.siteId, null);
  assert.equal(consentAudit.actorAccountId, null);
  assert.equal(consentAudit.reason, 'Worker personal confirmation');
  assert.deepEqual(consentAudit.changes, {
    workerId,
    consentVersion: 'synthetic-v1',
    method: 'SUPERVISED_WORKER_CONFIRMATION',
  });
  const activatedAuditCount = await dataSource.getRepository(AccessAuditEntity).countBy({
    siteId,
    action: 'FACE_PROFILE_ACTIVATED',
    entityId: profile.id,
  });
  assert.equal(activatedAuditCount, 1);

  const [{ safety_revision: initialSafetyRevision }] = (await dataSource.query(
    'SELECT safety_revision FROM face_profile WHERE id = $1',
    [profile.id],
  )) as [{ safety_revision: string }];
  assert.match(initialSafetyRevision, /^[0-9a-f-]{36}$/i);
  const syntheticConsentSourceId = randomUUID();
  const syntheticConsentSourceHash = createHash('sha256')
    .update(`SYNTHETIC_ONLY:SAFETY_MF06:${syntheticConsentSourceId}:${profile.id}`)
    .digest('hex');
  await assert.rejects(
    dataSource.query('UPDATE face_profile SET safety_revision = $1 WHERE id = $2', [
      randomUUID(),
      profile.id,
    ]),
    /Face revision is database owned/,
  );
  await assert.rejects(
    dataSource.query(
      `INSERT INTO safety_face_consent (
        id, profile_id, profile_revision, purpose,
        consent_version, consent_method, consented_at,
        source_record_id, source_record_hash, recorded_by_user_id
      ) VALUES ($1, $2, $3, 'SAFETY_MF06', 'synthetic-v1', 'SUPERVISED_WORKER_CONFIRMATION',
        statement_timestamp(), $4, $5, $6)`,
      [
        randomUUID(),
        profile.id,
        randomUUID(),
        syntheticConsentSourceId,
        syntheticConsentSourceHash,
        actorId,
      ],
    ),
    /Safety consent profile provenance unavailable/,
  );
  const safetyConsentId = randomUUID();
  await assert.rejects(
    dataSource.query(
      `INSERT INTO safety_face_consent (
        id, profile_id, profile_revision, purpose,
        consent_version, consent_method, consented_at,
        source_record_id, source_record_hash, recorded_by_user_id
      ) VALUES ($1, $2, $3, 'SAFETY_MF06', 'synthetic-v1', 'SUPERVISED_WORKER_CONFIRMATION',
        statement_timestamp() + interval '1 second', $4, $5, $6)`,
      [
        safetyConsentId,
        profile.id,
        initialSafetyRevision,
        syntheticConsentSourceId,
        syntheticConsentSourceHash,
        actorId,
      ],
    ),
    /Safety consent profile provenance unavailable/,
  );
  await dataSource.query(
    `INSERT INTO safety_face_consent (
      id, profile_id, profile_revision, purpose,
      consent_version, consent_method, consented_at,
      source_record_id, source_record_hash, recorded_by_user_id
    ) VALUES ($1, $2, $3, 'SAFETY_MF06', 'synthetic-v1', 'SUPERVISED_WORKER_CONFIRMATION',
      statement_timestamp(), $4, $5, $6)`,
    [
      safetyConsentId,
      profile.id,
      initialSafetyRevision,
      syntheticConsentSourceId,
      syntheticConsentSourceHash,
      actorId,
    ],
  );
  await assert.rejects(
    dataSource.query('DELETE FROM safety_face_consent WHERE id = $1', [safetyConsentId]),
    /Safety Face consent provenance is immutable/,
  );

  const gate = new FaceGateService(dataSource, adapter);
  await assert.rejects(gate.verify(otherSecurityOfficerActor, siteId, 'gate1', frame));

  const matched = await gate.verify(actor, siteId, 'gate1', frame);
  assert.equal(verification?.templates?.length, 1);
  assert.equal(matched.worker?.userId, accountId);
  assert.notEqual(matched.decision.authorization, 'ALLOWED'); // account is not permission
  assert.equal(matched.log?.workerId, workerId);

  await dataSource
    .getRepository(ContractorEntity)
    .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
  await dataSource.getRepository(WorkerEntity).update(workerId, { contractorId });
  await dataSource.getRepository(ContractorSiteParticipationEntity).save({
    id: participationId,
    contractorId,
    siteId,
    validFrom: new Date(Date.now() - 60_000),
    validUntil: null,
    isActive: true,
  });
  await dataSource.getRepository(ContractorRepresentativeGrantEntity).save({
    id: randomUUID(),
    userId: contractorRepId,
    contractorId,
  });
  assert.equal((await enrollment.getProfile(contractorRepActor, workerId)).id, profile.id);
  await assert.rejects(
    enrollment.getProfile(
      {
        id: unassignedUserId,
        mustChangePassword: false,
        roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
      },
      workerId,
    ),
  );

  await dataSource.getRepository(WorkerSiteZoneAssignmentEntity).save({
    id: assignmentId,
    workerId,
    siteId,
    siteContractorId: participationId,
    zoneIds: [randomUUID()],
    status: WorkerSiteZoneAssignmentStatus.APPROVED,
    validFrom: new Date(Date.now() - 60_000),
    validUntil: new Date(Date.now() + 3600_000),
    requestedByUserId: actorId,
  });
  await dataSource.getRepository(WorkerGatePermissionEntity).save({
    workerAssignmentId: assignmentId,
    id: randomUUID(),
    workerId,
    siteId,
    gateId: 'gate1',
    validFrom: new Date(Date.now() - 60_000),
    validUntil: null,
    createdByUserId: actorId,
  });

  const deniedNoShift = await gate.verify(actor, siteId, 'gate1', frame, 'IN');
  assert.equal(deniedNoShift.decision.authorization, 'DENIED');
  assert.equal(deniedNoShift.decision.reasonCode, 'NO_SCHEDULE');
  assert.equal(deniedNoShift.decision.qrFallbackAllowed, false);
  assert.equal(deniedNoShift.attempt?.status, 'DENIED');

  await assignTestShift(dataSource, siteId, workerId);
  const allowed = await gate.verify(actor, siteId, 'gate1', frame, 'OUT');
  assert.equal(allowed.decision.authorization, 'ALLOWED');
  assert.equal(allowed.log?.direction, 'OUT');
  assert.equal(allowed.log?.userId, accountId);
  const savedLog = await dataSource
    .getRepository(GateAccessLogEntity)
    .findOneByOrFail({ id: allowed.log!.id });
  assert.equal(savedLog.decision.authorization, 'ALLOWED');
  const afterRestart = await new FaceGateService(dataSource, adapter).listLogs(
    actor,
    siteId,
    'gate1',
  );
  assert.ok(afterRestart.items.some((log) => log.id === allowed.log?.id));

  const countBeforeUnknown = await dataSource
    .getRepository(GateAccessLogEntity)
    .countBy({ siteId });
  const presenceSessionId = randomUUID();
  const presence = await gate.observe(actor, siteId, 'gate1', presenceSessionId, frame);
  assert.equal(presence.state, 'NEW_FACE');
  assert.deepEqual(verification?.templates, []);
  assert.match(verification?.gatePresenceSession ?? '', /^[a-f0-9]{64}$/);
  const presenceScope = verification?.gatePresenceSession;
  await gate.observe(actor, siteId, 'gate2', presenceSessionId, frame);
  assert.notEqual(verification?.gatePresenceSession, presenceScope);
  await assert.rejects(gate.observe(workerActor, siteId, 'gate1', presenceSessionId, frame));
  assert.equal(
    await dataSource.getRepository(GateAccessLogEntity).countBy({ siteId }),
    countBeforeUnknown,
  );

  for (const status of ['UNKNOWN', 'LOW_CONFIDENCE', 'QUALITY_FAILED', 'AI_UNAVAILABLE'] as const) {
    technicalStatus = status;
    const unknown = await gate.verify(actor, siteId, 'gate1', frame);
    assert.equal(unknown.worker, undefined);
    assert.equal(unknown.log, undefined);
    assert.equal(
      await dataSource.getRepository(GateAccessLogEntity).countBy({ siteId }),
      countBeforeUnknown,
    );
  }
  technicalStatus = 'MATCHED';
  await assert.rejects(gate.verify({ ...actor, id: randomUUID() }, siteId, 'gate1', frame)); // cannot acknowledge ALLOWED when audit persistence fails
  assert.equal((await gate.verify(actor, siteId, 'gate2', frame)).decision.authorization, 'DENIED');
  await assert.rejects(gate.listLogs(workerActor, siteId, 'gate1'));
  await assert.rejects(gate.listLogs(otherSecurityOfficerActor, siteId, 'gate1'));
  await assert.rejects(gate.verify(actor, siteId, 'gate1', frame, 'INVALID' as 'IN'));

  const permissions = new WorkerGatePermissionsService(dataSource);
  const current = await permissions.list(actor, siteId, workerId);
  const changed = await permissions.set(actor, siteId, workerId, {
    gateIds: ['gate-north-01', 'gate-west-02'],
    expectedPermissionIds: current.items.map((item) => item.id),
  });
  assert.equal(
    (await gate.verify(actor, siteId, 'gate-north-01', frame)).decision.authorization,
    'ALLOWED',
  );
  assert.equal(
    (await gate.verify(actor, siteId, 'gate-west-02', frame)).decision.authorization,
    'ALLOWED',
  );
  assert.equal((await gate.verify(actor, siteId, 'gate1', frame)).decision.authorization, 'DENIED');
  assert.equal(
    (await gate.verify(actor, siteId, 'gate-logistics-03', frame)).decision.authorization,
    'DENIED',
  );
  await assert.rejects(
    permissions.set(actor, siteId, workerId, {
      gateIds: [],
      expectedPermissionIds: current.items.map((item) => item.id),
    }),
  );
  await assert.rejects(
    permissions.set(actor, siteId, workerId, {
      gateIds: ['unknown-gate'],
      expectedPermissionIds: changed.items.map((item) => item.id),
    }),
  );
  await assert.rejects(permissions.list(actor, otherSiteId, workerId));
  await assert.rejects(permissions.list(workerActor, siteId, workerId));
  assert.ok((await permissions.list(siteManagerActor, siteId, workerId)).items.length);
  await assert.rejects(
    permissions.set(otherSiteManagerActor, siteId, workerId, {
      gateIds: [],
      expectedPermissionIds: changed.items.map((item) => item.id),
    }),
  );
  await assert.rejects(
    permissions.set(securityOfficerActor, siteId, workerId, {
      gateIds: [],
      expectedPermissionIds: changed.items.map((item) => item.id),
    }),
  );

  const concurrent = await Promise.allSettled([
    permissions.set(actor, siteId, workerId, {
      gateIds: ['gate-north-01'],
      expectedPermissionIds: changed.items.map((item) => item.id),
    }),
    permissions.set(actor, siteId, workerId, {
      gateIds: ['gate-west-02'],
      expectedPermissionIds: changed.items.map((item) => item.id),
    }),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);

  const last = await permissions.list(actor, siteId, workerId);
  await permissions.set(actor, siteId, workerId, {
    gateIds: [],
    expectedPermissionIds: last.items.map((item) => item.id),
  });
  assert.equal(
    (await gate.verify(actor, siteId, 'gate-north-01', frame)).decision.authorization,
    'DENIED',
  );
  assert.equal(
    (await gate.verify(actor, siteId, 'gate-west-02', frame)).decision.authorization,
    'DENIED',
  );

  await gate.verify(actor, otherSiteId, 'gate1', frame);
  assert.equal(verification?.templates?.length, 0);

  // Disabling UserEntity rejects account lookup, while worker identity at the gate remains independent of login account
  await dataSource.getRepository(UserEntity).update(accountId, { isActive: false });
  await assert.rejects(workforce.forAccount(siteId, { userId: accountId }));
  const disabledAccountResult = await gate.verify(actor, siteId, 'gate1', frame);
  assert.equal(verification?.templates?.length, 1);
  assert.equal(disabledAccountResult.worker?.id, workerId);
  assert.equal(disabledAccountResult.worker?.userId, null);

  // Disabling WorkerEntity excludes the inactive worker's template from gate entry matching
  await dataSource.getRepository(WorkerEntity).update(workerId, { isActive: false });
  const disabledWorkerResult = await gate.verify(actor, siteId, 'gate1', frame, 'IN');
  assert.equal(verification?.templates?.length, 0);
  assert.equal(disabledWorkerResult.worker, undefined);

  await dataSource.getRepository(WorkerEntity).update(workerId, { isActive: true });
  await dataSource.getRepository(UserEntity).update(accountId, { isActive: true });

  // Withdrawing their own consent remains available to the linked Worker in Main.
  await enrollment.revokeProfile(workerActor, workerId);
  const revoked = await dataSource
    .getRepository(FaceProfileEntity)
    .createQueryBuilder('profile')
    .addSelect('profile.encryptedTemplate')
    .where('profile.id = :id', { id: profile.id })
    .getOneOrFail();
  assert.equal(revoked.status, 'REVOKED');
  assert.equal(revoked.encryptedTemplate, null);
  assert.equal(revoked.revokedByUserId, workerActor.id);

  const [{ safety_revision: revokedSafetyRevision }] = (await dataSource.query(
    'SELECT safety_revision FROM face_profile WHERE id = $1',
    [profile.id],
  )) as [{ safety_revision: string }];
  assert.notEqual(revokedSafetyRevision, initialSafetyRevision);

  const syntheticRevocationSourceId = randomUUID();
  const syntheticRevocationSourceHash = createHash('sha256')
    .update(`SYNTHETIC_ONLY:SAFETY_REVOCATION:${syntheticRevocationSourceId}:${safetyConsentId}`)
    .digest('hex');
  await dataSource.query(
    `INSERT INTO safety_face_consent_revocation (
      consent_id, revoked_at, source_record_id, source_record_hash, recorded_by_user_id
    ) VALUES ($1, statement_timestamp(), $2, $3, $4)`,
    [
      safetyConsentId,
      syntheticRevocationSourceId,
      syntheticRevocationSourceHash,
      revoked.revokedByUserId,
    ],
  );
  await assert.rejects(
    dataSource.query('DELETE FROM safety_face_consent_revocation WHERE consent_id = $1', [
      safetyConsentId,
    ]),
    /Safety Face consent provenance is immutable/,
  );

  await gate.verify(actor, siteId, 'gate1', frame);
  assert.equal(verification?.templates?.length, 0);
});
