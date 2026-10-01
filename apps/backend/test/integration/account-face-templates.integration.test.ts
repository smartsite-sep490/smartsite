import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { FaceEnrollmentService } from '../../src/modules/workforce/face-enrollment.service.js';
import { FaceEnrollmentController } from '../../src/modules/workforce/face-enrollment.controller.js';
import { FaceGateService } from '../../src/modules/workforce/face-gate.service.js';
import { WorkerGatePermissionsService } from '../../src/modules/workforce/worker-gate-permissions.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/contractor-operations.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/workforce-configuration.service.js';
import {
  FaceProfileEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  SiteEntity,
  WorkerEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  WorkerGatePermissionEntity,
  GateAccessLogEntity,
} from '../../src/database/entities/index.js';
import type { FaceVerificationInput } from '../../src/modules/workforce/face-enrollment.adapter.js';
import type { FaceVerificationTechnicalOutcome } from '@smartsite/contracts';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('account linking, encrypted DB enrollment, scoped matching and revocation', async () => {
  await dataSource.initialize();
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const accountId = randomUUID();
  const actorId = randomUUID();
  const workerId = randomUUID();
  const secondWorkerId = randomUUID();
  const contractorId = randomUUID();
  const actor = {
    id: actorId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  const cipher = 'gAAAA' + 'a'.repeat(150) + '=='; // synthetic ciphertext; no real biometric data
  let reference = '';
  let verification: FaceVerificationInput | undefined;
  let technicalStatus: FaceVerificationTechnicalOutcome = 'MATCHED';
  const adapter = {
    async assessSampleQuality() {
      return { status: 'ACCEPTED' as const };
    },
    async submitSample(input: { sampleIndex: number }) {
      return { acceptedSampleCount: input.sampleIndex };
    },
    async completeEnrollment(sessionId: string) {
      reference = `fp_${sessionId.replaceAll('-', '')}`;
      return {
        profileReference: reference,
        modelVersion: 'synthetic-v1',
        encryptedTemplate: cipher,
      };
    },
    async verify(input: FaceVerificationInput) {
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
  try {
    for (const id of [siteId, otherSiteId])
      await dataSource.getRepository(SiteEntity).save({ id, code: id, name: 'Synthetic site' });
    for (const id of [accountId, actorId])
      await dataSource.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic user',
        passwordHash: 'synthetic-not-a-login-hash',
        isActive: true,
        mustChangePassword: false,
      });
    await dataSource
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId: accountId, role: UserRole.WORKER, siteId });
    for (const id of [workerId, secondWorkerId])
      await dataSource
        .getRepository(WorkerEntity)
        .save({ id, siteId, externalId: id, displayName: 'Synthetic worker', isActive: true });
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
    await assert.rejects(
      enrollment.start(actor, workerId, { consentVersion: 'synthetic-v1' }),
      /Link an account/,
    );
    await assert.rejects(workforce.linkAccount(otherSiteId, workerId, { userId: accountId }));
    await assert.rejects(
      workforce.linkAccount(siteId, workerId, { userId: actorId }),
      /account assigned/,
    );
    await workforce.linkAccount(siteId, workerId, { userId: accountId });
    assert.equal((await workforce.forAccount(siteId, { userId: accountId })).id, workerId);
    await assert.rejects(workforce.forAccount(otherSiteId, { userId: accountId }));
    await workforce.linkAccount(siteId, workerId, { userId: accountId }); // idempotent
    await assert.rejects(workforce.linkAccount(siteId, secondWorkerId, { userId: accountId }));
    const session = await enrollment.start(actor, workerId, { consentVersion: 'synthetic-v1' });
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
    assert.equal(
      profile.profileReferenceHash,
      createHash('sha256').update(reference).digest('hex'),
    );
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
    const gate = new FaceGateService(dataSource, adapter);
    await assert.rejects(
      gate.verify(
        { ...actor, roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: otherSiteId }] },
        siteId,
        'gate1',
        frame,
      ),
    );
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
      id: randomUUID(),
      contractorId,
      siteId,
      validFrom: new Date(Date.now() - 60_000),
      validUntil: null,
      isActive: true,
    });
    await dataSource.getRepository(WorkerGatePermissionEntity).save({
      id: randomUUID(),
      workerId,
      siteId,
      gateId: 'gate1',
      validFrom: new Date(Date.now() - 60_000),
      validUntil: null,
      createdByUserId: actorId,
    });
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
    for (const status of [
      'UNKNOWN',
      'LOW_CONFIDENCE',
      'QUALITY_FAILED',
      'AI_UNAVAILABLE',
    ] as const) {
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
    assert.equal(
      (await gate.verify(actor, siteId, 'gate2', frame)).decision.authorization,
      'DENIED',
    );
    await assert.rejects(
      gate.listLogs(
        { ...actor, roleAssignments: [{ role: UserRole.WORKER, siteId }] },
        siteId,
        'gate1',
      ),
    );
    await assert.rejects(
      gate.listLogs(
        { ...actor, roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: otherSiteId }] },
        siteId,
        'gate1',
      ),
    );
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
    assert.equal(
      (await gate.verify(actor, siteId, 'gate1', frame)).decision.authorization,
      'DENIED',
    );
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
    await assert.rejects(
      permissions.list(
        { ...actor, roleAssignments: [{ role: UserRole.WORKER, siteId }] },
        siteId,
        workerId,
      ),
    );
    await assert.rejects(
      permissions.set(
        { ...actor, roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }] },
        siteId,
        workerId,
        { gateIds: [], expectedPermissionIds: changed.items.map((item) => item.id) },
      ),
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
    await dataSource.getRepository(UserEntity).update(accountId, { isActive: false });
    await assert.rejects(workforce.forAccount(siteId, { userId: accountId }));
    const disabled = await gate.verify(actor, siteId, 'gate1', frame);
    assert.equal(verification?.templates?.length, 0);
    assert.equal(disabled.worker, undefined);
    await dataSource.getRepository(UserEntity).update(accountId, { isActive: true });
    await enrollment.revokeProfile(actor, workerId);
    const revoked = await dataSource
      .getRepository(FaceProfileEntity)
      .createQueryBuilder('profile')
      .addSelect('profile.encryptedTemplate')
      .where('profile.id = :id', { id: profile.id })
      .getOneOrFail();
    assert.equal(revoked.encryptedTemplate, null);
    await gate.verify(actor, siteId, 'gate1', frame);
    assert.equal(verification?.templates?.length, 0);
  } finally {
    await dataSource.query('DELETE FROM worker_gate_permission WHERE site_id = ANY($1)', [
      [siteId, otherSiteId],
    ]);
    await dataSource.query('DELETE FROM gate_access_log WHERE site_id = ANY($1)', [
      [siteId, otherSiteId],
    ]);
    await dataSource.query('DELETE FROM worker_site_zone_assignment WHERE worker_id = $1', [
      workerId,
    ]);
    await dataSource.query('DELETE FROM contractor_site_participation WHERE contractor_id = $1', [
      contractorId,
    ]);
    await dataSource.query('DELETE FROM face_profile WHERE worker_id = $1', [workerId]);
    await dataSource.query('DELETE FROM face_enrollment_session WHERE worker_id = $1', [workerId]);
    await dataSource.query('DELETE FROM worker WHERE id = ANY($1)', [[workerId, secondWorkerId]]);
    await dataSource.query('DELETE FROM contractor WHERE id = $1', [contractorId]);
    await dataSource.query('DELETE FROM app_user WHERE id = ANY($1)', [[accountId, actorId]]);
    await dataSource.query('DELETE FROM site WHERE id = ANY($1)', [[siteId, otherSiteId]]);
  }
});
