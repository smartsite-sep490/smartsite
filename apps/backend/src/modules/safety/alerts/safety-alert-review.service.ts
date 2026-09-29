import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Length, Min } from 'class-validator';
import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { command, conflict, missing, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { AlertStatus } from '../../../database/entities/enums.js';
import { SafetyAlertReviewEntity } from '../../../database/entities/safety-alert-review.entity.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';

export const REVIEW_TARGET_STATUSES = [
  AlertStatus.CONFIRMED,
  AlertStatus.DISMISSED,
  AlertStatus.NEEDS_MORE_EVIDENCE,
] as const;

export type ReviewTargetStatus = (typeof REVIEW_TARGET_STATUSES)[number];

const ALLOWED_TRANSITIONS: ReadonlyMap<AlertStatus, ReadonlySet<ReviewTargetStatus>> = new Map([
  [
    AlertStatus.PENDING_REVIEW,
    new Set([AlertStatus.CONFIRMED, AlertStatus.DISMISSED, AlertStatus.NEEDS_MORE_EVIDENCE]),
  ],
  [AlertStatus.NEEDS_MORE_EVIDENCE, new Set([AlertStatus.CONFIRMED, AlertStatus.DISMISSED])],
]);

export class ReviewSafetyAlertCommand {
  @IsUUID()
  commandId!: string;

  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsIn(REVIEW_TARGET_STATUSES)
  targetStatus!: ReviewTargetStatus;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(5, 1000)
  reason!: string;
}

export interface SafetyAlertReviewResult {
  alert: SafetyAlertEntity;
  review: SafetyAlertReviewEntity;
  replayed: boolean;
}

export function canReviewTransition(
  fromStatus: AlertStatus,
  toStatus: AlertStatus,
): toStatus is ReviewTargetStatus {
  return ALLOWED_TRANSITIONS.get(fromStatus)?.has(toStatus as ReviewTargetStatus) ?? false;
}

function invalidTransition(fromStatus: AlertStatus, toStatus: AlertStatus): never {
  throw new PublicHttpException(HttpStatus.CONFLICT, {
    code: 'CONFLICT',
    message: `Safety alert cannot transition from ${fromStatus} to ${toStatus}`,
  });
}

@Injectable()
export class SafetyAlertReviewService {
  constructor(private readonly dataSource: DataSource) {}

  async review(
    siteId: string,
    alertId: string,
    actorUserId: string,
    input: ReviewSafetyAlertCommand,
  ): Promise<SafetyAlertReviewResult> {
    const scopedSiteId = uuid(siteId);
    const scopedAlertId = uuid(alertId);
    const scopedActorId = uuid(actorUserId);
    const value = command(ReviewSafetyAlertCommand, input);

    return await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `safety-alert-review:${value.commandId}`,
      ]);

      const reviewRepository = manager.getRepository(SafetyAlertReviewEntity);
      const existing = await reviewRepository.findOneBy({ id: value.commandId });
      if (existing) {
        if (
          existing.siteId !== scopedSiteId ||
          existing.alertId !== scopedAlertId ||
          existing.actorUserId !== scopedActorId ||
          existing.toStatus !== value.targetStatus ||
          existing.reason !== value.reason ||
          existing.alertRevision !== value.expectedRevision + 1
        ) {
          conflict('Review command ID is already used with different input');
        }
        const replayAlert = await manager
          .getRepository(SafetyAlertEntity)
          .findOneBy({ id: scopedAlertId, siteId: scopedSiteId });
        if (!replayAlert) missing();
        return { alert: replayAlert, review: existing, replayed: true };
      }

      const alertRepository = manager.getRepository(SafetyAlertEntity);
      const alert = await alertRepository
        .createQueryBuilder('alert')
        .setLock('pessimistic_write')
        .where('alert.id = :alertId', { alertId: scopedAlertId })
        .andWhere('alert.siteId = :siteId', { siteId: scopedSiteId })
        .getOne();
      if (!alert) missing();
      if (alert.revision !== value.expectedRevision) {
        conflict('Safety alert revision is stale');
      }
      if (!canReviewTransition(alert.status, value.targetStatus)) {
        invalidTransition(alert.status, value.targetStatus);
      }

      const fromStatus = alert.status;
      alert.status = value.targetStatus;
      alert.revision += 1;
      const updatedAlert = await alertRepository.save(alert);
      const review = await reviewRepository.save({
        id: value.commandId,
        alertId: scopedAlertId,
        siteId: scopedSiteId,
        actorUserId: scopedActorId,
        fromStatus,
        toStatus: value.targetStatus,
        reason: value.reason,
        alertRevision: updatedAlert.revision,
      });
      return { alert: updatedAlert, review, replayed: false };
    });
  }
}
