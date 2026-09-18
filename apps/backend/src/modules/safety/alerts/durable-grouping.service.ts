import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type EntityManager } from 'typeorm';
import { AlertStatus, AlertType } from '../../../database/entities/enums.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import type { AlertCandidate } from './alert-candidate-evaluator.js';

const OPEN_ALERT_STATUSES = [
  AlertStatus.PENDING_REVIEW,
  AlertStatus.NEEDS_MORE_EVIDENCE,
  AlertStatus.CONFIRMED,
];

@Injectable()
export class DurableGroupingService {
  constructor(private readonly configService?: ConfigService) {}

  private getCooldownMs(): number {
    const rawSeconds = this.configService?.get<number | string>('ALERT_COOLDOWN_SECONDS');
    const parsed = typeof rawSeconds === 'number' ? rawSeconds : Number(rawSeconds);
    const cooldownSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
    return cooldownSeconds * 1000;
  }

  async groupCandidate(
    manager: EntityManager,
    siteId: string,
    candidate: AlertCandidate,
    capturedAt: Date,
  ): Promise<SafetyAlertEntity> {
    const lockKey = `${siteId}:${candidate.groupingKey}`;
    // 1. Transaction-scoped advisory lock serializes concurrent grouping calls for this site & groupingKey
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

    const cooldownMs = this.getCooldownMs();
    const capturedMs = capturedAt.getTime();

    // 2. Query open alerts with pessimistic_write (FOR UPDATE) to prevent concurrent mutation race
    const openAlerts = await manager
      .createQueryBuilder(SafetyAlertEntity, 'alert')
      .setLock('pessimistic_write')
      .where('alert.siteId = :siteId', { siteId })
      .andWhere('alert.groupingKey = :groupingKey', { groupingKey: candidate.groupingKey })
      .andWhere('alert.status IN (:...openStatuses)', { openStatuses: OPEN_ALERT_STATUSES })
      .orderBy('alert.lastDetectedAt', 'DESC')
      .addOrderBy('alert.createdAt', 'DESC')
      .getMany();

    // 3. Find an open alert whose cooldown window actually covers capturedAt
    // An alert's cooldown window covers capturedAt if:
    // capturedAt is between (firstDetectedAt - cooldownMs) and (lastDetectedAt + cooldownMs)
    let matchedAlert: SafetyAlertEntity | undefined;

    for (const alert of openAlerts) {
      const firstMs = alert.firstDetectedAt.getTime();
      const lastMs = alert.lastDetectedAt.getTime();
      const isWithinCooldownWindow =
        capturedMs >= firstMs - cooldownMs && capturedMs <= lastMs + cooldownMs;

      if (isWithinCooldownWindow) {
        matchedAlert = alert;
        break;
      }
    }

    if (matchedAlert) {
      const lastDetectedMs = matchedAlert.lastDetectedAt.getTime();
      const newLastDetectedAt =
        capturedMs > lastDetectedMs ? capturedAt : matchedAlert.lastDetectedAt;

      // 4. Narrow conditional update: mutate ONLY detection_count and last_detected_at.
      // Guard status to ensure we never reopen a row that was closed concurrently.
      // Never mutate identity evidence columns (candidateWorkerId, identitySimilarityScore, identityQualityScore) or status.
      const updateResult = await manager
        .createQueryBuilder()
        .update(SafetyAlertEntity)
        .set({
          detectionCount: () => 'detection_count + 1',
          lastDetectedAt: newLastDetectedAt,
        })
        .where('id = :id', { id: matchedAlert.id })
        .andWhere('status IN (:...openStatuses)', { openStatuses: OPEN_ALERT_STATUSES })
        .execute();

      if (updateResult.affected && updateResult.affected > 0) {
        const updated = await manager
          .getRepository(SafetyAlertEntity)
          .findOneBy({ id: matchedAlert.id });
        if (updated) {
          return updated;
        }
      }
    }

    // 5. If no matching open alert within cooldown, or if the alert was closed concurrently: create new Alert
    const alertRepo = manager.getRepository(SafetyAlertEntity);
    const newAlert = alertRepo.create({
      id: randomUUID(),
      siteId,
      zoneId: candidate.zoneId ?? null,
      candidateWorkerId: candidate.candidateWorkerId ?? null,
      identitySimilarityScore: candidate.identitySimilarityScore ?? null,
      identityQualityScore: candidate.identityQualityScore ?? null,
      alertType: candidate.alertType as AlertType,
      candidateSubtype: candidate.candidateSubtype,
      groupingKey: candidate.groupingKey,
      status: AlertStatus.PENDING_REVIEW,
      firstDetectedAt: capturedAt,
      lastDetectedAt: capturedAt,
      detectionCount: 1,
    });

    return await alertRepo.save(newAlert);
  }
}
