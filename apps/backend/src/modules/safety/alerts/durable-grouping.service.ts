import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../../config/environment.js';
import { type EntityManager } from 'typeorm';
import { AlertStatus, AlertType } from '../../../database/entities/enums.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import type { AlertCandidate } from './alert-candidate-evaluator.js';

const OPEN_ALERT_STATUSES = [
  AlertStatus.PENDING_REVIEW,
  AlertStatus.NEEDS_MORE_EVIDENCE,
  AlertStatus.CONFIRMED,
];

// Safe bounds compatible with both ECMAScript Date and PostgreSQL timestamptz (4-digit ISO years)
// Prevents JS Date overflow (Invalid Date) when ALERT_COOLDOWN_SECONDS is configured near MAX_SAFE_INTEGER.
const MIN_SAFE_DATE_MS = -62_135_596_800_000; // 0001-01-01T00:00:00.000Z
const MAX_SAFE_DATE_MS = 253_402_300_799_999; // 9999-12-31T23:59:59.999Z

@Injectable()
export class DurableGroupingService {
  constructor(private readonly configService: ConfigService<BackendEnvironment, true>) {}

  private getCooldownMs(): number {
    return this.configService.getOrThrow('ALERT_COOLDOWN_SECONDS', { infer: true }) * 1000;
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

    // Clamp computed boundaries to safe date ranges to avoid Invalid Date on large cooldown configurations
    const minLastDetectedMs = Math.max(MIN_SAFE_DATE_MS, capturedMs - cooldownMs);
    const maxFirstDetectedMs = Math.min(MAX_SAFE_DATE_MS, capturedMs + cooldownMs);

    const minLastDetectedAt = new Date(minLastDetectedMs);
    const maxFirstDetectedAt = new Date(maxFirstDetectedMs);

    // 2. Query open alerts matching time-window eligibility directly in SQL before FOR UPDATE.
    // Filtering by time-window in SQL ensures PostgreSQL locks ONLY eligible rows within cooldown.
    // Explicit limit(1) emits LIMIT 1 with FOR UPDATE so PostgreSQL locks ONLY the top ordered eligible
    // row, preventing blocking on other still-eligible rows held by concurrent human transactions.
    // Preserves out-of-order semantics: firstDetectedAt <= capturedAt+cooldown AND lastDetectedAt >= capturedAt-cooldown.
    const matchingAlerts = await manager
      .createQueryBuilder(SafetyAlertEntity, 'alert')
      .setLock('pessimistic_write')
      .where('alert.siteId = :siteId', { siteId })
      .andWhere('alert.groupingKey = :groupingKey', { groupingKey: candidate.groupingKey })
      .andWhere('alert.status IN (:...openStatuses)', { openStatuses: OPEN_ALERT_STATUSES })
      .andWhere('alert.firstDetectedAt <= :maxFirstDetectedAt', { maxFirstDetectedAt })
      .andWhere('alert.lastDetectedAt >= :minLastDetectedAt', { minLastDetectedAt })
      .orderBy('alert.lastDetectedAt', 'DESC')
      .addOrderBy('alert.createdAt', 'DESC')
      .limit(1)
      .getMany();

    const matchedAlert = matchingAlerts[0];

    if (matchedAlert) {
      const lastDetectedMs = matchedAlert.lastDetectedAt.getTime();
      const newLastDetectedAt =
        capturedMs > lastDetectedMs ? capturedAt : matchedAlert.lastDetectedAt;

      // 3. Narrow conditional update: mutate ONLY detection_count and last_detected_at.
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

    // 4. If no matching open alert within cooldown, or if the alert was closed concurrently: create new Alert
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
