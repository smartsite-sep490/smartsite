import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { AlertStatus, AlertType } from '../../src/database/entities/enums.js';
import { SafetyAlertReviewEntity } from '../../src/database/entities/safety-alert-review.entity.js';
import { SafetyAlertEntity } from '../../src/database/entities/safety-alert.entity.js';
import { SiteEntity } from '../../src/database/entities/site.entity.js';
import { UserEntity } from '../../src/database/entities/user.entity.js';
import { SafetyAlertReviewService } from '../../src/modules/safety/alerts/safety-alert-review.service.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('safety alert review is scoped, audited, idempotent and revision-safe', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const actorUserId = randomUUID();
  const alertId = randomUUID();
  const commandId = randomUUID();
  const sites = dataSource.getRepository(SiteEntity);
  const users = dataSource.getRepository(UserEntity);
  const alerts = dataSource.getRepository(SafetyAlertEntity);
  const reviews = dataSource.getRepository(SafetyAlertReviewEntity);
  try {
    await sites.save([
      { id: siteId, code: `REVIEW-${siteId.slice(0, 8)}`, name: 'Review Site' },
      { id: otherSiteId, code: `OTHER-${otherSiteId.slice(0, 8)}`, name: 'Other Site' },
    ]);
    await users.save({
      id: actorUserId,
      username: `reviewer-${actorUserId.slice(0, 8)}`,
      displayName: 'Safety Reviewer',
      passwordHash: 'not-used-by-this-test',
      isActive: true,
      mustChangePassword: false,
    });
    await alerts.save({
      id: alertId,
      siteId,
      zoneId: null,
      candidateWorkerId: null,
      identitySimilarityScore: null,
      identityQualityScore: null,
      alertType: AlertType.PPE_VIOLATION,
      candidateSubtype: 'PPE_HARD_HAT_MISSING',
      groupingKey: `review:${alertId}`,
      status: AlertStatus.PENDING_REVIEW,
      firstDetectedAt: new Date('2026-09-29T00:00:00Z'),
      lastDetectedAt: new Date('2026-09-29T00:00:01Z'),
      detectionCount: 1,
    });

    const service = new SafetyAlertReviewService(dataSource);
    const input = {
      commandId,
      expectedRevision: 0,
      targetStatus: AlertStatus.NEEDS_MORE_EVIDENCE,
      reason: 'The worker helmet area is partially occluded.',
    } as const;
    const created = await service.review(siteId, alertId, actorUserId, input);
    assert.equal(created.replayed, false);
    assert.equal(created.alert.status, AlertStatus.NEEDS_MORE_EVIDENCE);
    assert.equal(created.alert.revision, 1);
    assert.equal(created.review.actorUserId, actorUserId);
    assert.equal(created.review.alertRevision, 1);

    const replay = await service.review(siteId, alertId, actorUserId, input);
    assert.equal(replay.replayed, true);
    assert.equal(await reviews.countBy({ alertId }), 1);

    await assert.rejects(
      service.review(siteId, alertId, actorUserId, { ...input, reason: 'Different retry body.' }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'CONFLICT',
    );
    await assert.rejects(
      service.review(siteId, alertId, actorUserId, {
        commandId: randomUUID(),
        expectedRevision: 0,
        targetStatus: AlertStatus.CONFIRMED,
        reason: 'The evidence clearly shows a missing hard hat.',
      }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'CONFLICT',
    );
    await assert.rejects(
      service.review(otherSiteId, alertId, actorUserId, {
        commandId: randomUUID(),
        expectedRevision: 1,
        targetStatus: AlertStatus.CONFIRMED,
        reason: 'Cross-site access must not find the alert.',
      }),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'NOT_FOUND',
    );
  } finally {
    await reviews.delete({ alertId });
    await alerts.delete({ id: alertId });
    await users.delete({ id: actorUserId });
    await sites.delete([siteId, otherSiteId]);
  }
});

test('two review commands using the same revision cannot both commit', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const siteId = randomUUID();
  const actorUserId = randomUUID();
  const alertId = randomUUID();
  const sites = dataSource.getRepository(SiteEntity);
  const users = dataSource.getRepository(UserEntity);
  const alerts = dataSource.getRepository(SafetyAlertEntity);
  const reviews = dataSource.getRepository(SafetyAlertReviewEntity);
  try {
    await sites.save({ id: siteId, code: `RACE-${siteId.slice(0, 8)}`, name: 'Review Race Site' });
    await users.save({
      id: actorUserId,
      username: `race-${actorUserId.slice(0, 8)}`,
      displayName: 'Race Reviewer',
      passwordHash: 'not-used-by-this-test',
      isActive: true,
      mustChangePassword: false,
    });
    await alerts.save({
      id: alertId,
      siteId,
      zoneId: null,
      candidateWorkerId: null,
      identitySimilarityScore: null,
      identityQualityScore: null,
      alertType: AlertType.RESTRICTED_ZONE_INTRUSION,
      candidateSubtype: 'ZONE_ENTRY_PROHIBITED',
      groupingKey: `race:${alertId}`,
      status: AlertStatus.PENDING_REVIEW,
      firstDetectedAt: new Date('2026-09-29T01:00:00Z'),
      lastDetectedAt: new Date('2026-09-29T01:00:01Z'),
      detectionCount: 1,
    });
    const service = new SafetyAlertReviewService(dataSource);
    const outcomes = await Promise.allSettled([
      service.review(siteId, alertId, actorUserId, {
        commandId: randomUUID(),
        expectedRevision: 0,
        targetStatus: AlertStatus.CONFIRMED,
        reason: 'Reviewer confirmed the restricted-zone entry.',
      }),
      service.review(siteId, alertId, actorUserId, {
        commandId: randomUUID(),
        expectedRevision: 0,
        targetStatus: AlertStatus.DISMISSED,
        reason: 'Reviewer classified this observation as a false positive.',
      }),
    ]);
    assert.equal(outcomes.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(({ status }) => status === 'rejected').length, 1);
    assert.equal(await reviews.countBy({ alertId }), 1);
    assert.equal((await alerts.findOneByOrFail({ id: alertId })).revision, 1);
  } finally {
    await reviews.delete({ alertId });
    await alerts.delete({ id: alertId });
    await users.delete({ id: actorUserId });
    await sites.delete({ id: siteId });
  }
});
