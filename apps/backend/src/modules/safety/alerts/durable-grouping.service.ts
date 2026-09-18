import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { In, type EntityManager } from 'typeorm';
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
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

    const alertRepo = manager.getRepository(SafetyAlertEntity);

    const existingAlerts = await alertRepo.find({
      where: {
        siteId,
        groupingKey: candidate.groupingKey,
        status: In(OPEN_ALERT_STATUSES),
      },
      order: {
        lastDetectedAt: 'DESC',
        createdAt: 'DESC',
      },
      take: 1,
    });

    const existingAlert = existingAlerts[0];
    const cooldownMs = this.getCooldownMs();
    const capturedMs = capturedAt.getTime();

    if (existingAlert) {
      const lastDetectedMs = existingAlert.lastDetectedAt.getTime();
      const isWithinCooldown = Math.abs(capturedMs - lastDetectedMs) <= cooldownMs;

      if (isWithinCooldown) {
        existingAlert.detectionCount += 1;
        if (capturedMs > lastDetectedMs) {
          existingAlert.lastDetectedAt = capturedAt;
        }

        // Leave all identity fields unchanged on repeat detections; initial evidence kept on creation only
        return await alertRepo.save(existingAlert);
      }
    }

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
