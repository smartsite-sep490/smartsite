import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { FaceEnrollmentService } from '../../src/modules/workforce/face-enrollment.service.js';
import { FaceEnrollmentController } from '../../src/modules/workforce/face-enrollment.controller.js';
import { FaceGateService } from '../../src/modules/workforce/face-gate.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/contractor-operations.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/workforce-configuration.service.js';
import {
  FaceProfileEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  SiteEntity,
  WorkerEntity,
} from '../../src/database/entities/index.js';
import type { FaceVerificationInput } from '../../src/modules/workforce/face-enrollment.adapter.js';
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
  const actor = {
    id: actorId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  const cipher = 'gAAAA' + 'a'.repeat(150) + '=='; // synthetic ciphertext; no real biometric data
  let reference = '';
  let verification: FaceVerificationInput | undefined;
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
    await gate.verify(actor, otherSiteId, 'gate1', frame);
    assert.equal(verification?.templates?.length, 0);
    await dataSource.getRepository(UserEntity).update(accountId, { isActive: false });
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
    await dataSource.query('DELETE FROM face_profile WHERE worker_id = $1', [workerId]);
    await dataSource.query('DELETE FROM face_enrollment_session WHERE worker_id = $1', [workerId]);
    await dataSource.query('DELETE FROM worker WHERE id = ANY($1)', [[workerId, secondWorkerId]]);
    await dataSource.query('DELETE FROM app_user WHERE id = ANY($1)', [[accountId, actorId]]);
    await dataSource.query('DELETE FROM site WHERE id = ANY($1)', [[siteId, otherSiteId]]);
  }
});
