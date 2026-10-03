import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  WorkerEntity,
  ZoneEntity,
} from '../../src/database/entities/index.js';
import {
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../../src/database/entities/worker-site-zone-assignment.entity.js';
import { ZoneAccessGrantEntity } from '../../src/database/entities/zone-access-grant.entity.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../src/database/entities/enums.js';
import { ContractorOperationsService } from '../../src/modules/workforce/contractor-operations.service.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('assignment reviews reread participation and roll back rejected transitions in PostgreSQL', async () => {
  await dataSource.initialize();
  const siteId = randomUUID();
  const userId = randomUUID();
  const contractorId = randomUUID();
  const workerId = randomUUID();
  const zoneId = randomUUID();
  const participationId = randomUUID();
  const from = new Date('2026-10-03T08:00:00Z');
  const until = new Date('2026-10-03T17:00:00Z');
  const assignments = dataSource.getRepository(WorkerSiteZoneAssignmentEntity);
  const participation = dataSource.getRepository(ContractorSiteParticipationEntity);
  const service = new ContractorOperationsService(dataSource);
  try {
    await dataSource
      .getRepository(SiteEntity)
      .save({ id: siteId, code: siteId, name: 'Synthetic assignment site' });
    await dataSource.getRepository(UserEntity).save({
      id: userId,
      username: userId,
      displayName: 'Synthetic reviewer',
      passwordHash: 'synthetic-not-a-login-hash',
      isActive: true,
      mustChangePassword: false,
    });
    await dataSource
      .getRepository(ContractorEntity)
      .save({ id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true });
    await dataSource.getRepository(WorkerEntity).save({
      id: workerId,
      siteId,
      contractorId,
      externalId: workerId,
      displayName: 'Synthetic worker',
      isActive: true,
    });
    await dataSource.getRepository(ZoneEntity).save({
      id: zoneId,
      siteId,
      code: zoneId,
      name: 'Synthetic zone',
      type: ZoneType.RESTRICTED,
      restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    });
    await participation.save({
      id: participationId,
      contractorId,
      siteId,
      validFrom: from,
      validUntil: until,
      isActive: true,
    });

    for (const stage of ['safetyReview', 'approval'] as const) {
      const status =
        stage === 'safetyReview'
          ? WorkerSiteZoneAssignmentStatus.PENDING
          : WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED;
      const requestId = randomUUID();
      await assignments.save({
        id: requestId,
        workerId,
        siteId,
        zoneIds: [zoneId],
        status,
        validFrom: from,
        validUntil: until,
        requestedByUserId: userId,
        safetyReviewedByUserId: null,
        siteManagerDecidedByUserId: null,
      });
      const actor = {
        id: userId,
        mustChangePassword: false,
        roleAssignments: [
          {
            role: stage === 'safetyReview' ? UserRole.SAFETY_OFFICER : UserRole.SITE_MANAGER,
            siteId,
          },
        ],
      };
      const advance = () =>
        stage === 'safetyReview'
          ? service.safetyReview(actor, requestId)
          : service.siteManagerDecision(actor, requestId, { approve: true });

      await participation.update(participationId, { isActive: false });
      await assert.rejects(
        advance(),
        (error: unknown) =>
          error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
      );
      const unchanged = await assignments.findOneByOrFail({ id: requestId });
      assert.equal(unchanged.status, status);
      assert.equal(unchanged.safetyReviewedByUserId, null);
      assert.equal(unchanged.siteManagerDecidedByUserId, null);

      await participation.update(participationId, { isActive: true });
      await advance();
      const accepted = await assignments.findOneByOrFail({ id: requestId });
      assert.equal(
        accepted.status,
        stage === 'safetyReview'
          ? WorkerSiteZoneAssignmentStatus.SAFETY_REVIEWED
          : WorkerSiteZoneAssignmentStatus.APPROVED,
      );
      assert.equal(await dataSource.getRepository(ZoneAccessGrantEntity).countBy({ workerId }), 0);
    }
  } finally {
    await assignments.delete({ workerId });
    await dataSource.getRepository(ZoneEntity).delete({ id: zoneId });
    await dataSource.getRepository(WorkerEntity).delete({ id: workerId });
    await participation.delete({ id: participationId });
    await dataSource.getRepository(ContractorEntity).delete({ id: contractorId });
    await dataSource.getRepository(UserEntity).delete({ id: userId });
    await dataSource.getRepository(SiteEntity).delete({ id: siteId });
  }
});
