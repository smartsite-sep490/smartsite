import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { invalid, missing, page, uuid } from '../../../common/configuration/commands.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../../../database/entities/alert-detection-mapping.entity.js';
import { AlertStatus, AlertType, EventProcessingStatus } from '../../../database/entities/enums.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import { SafetyAlertReviewEntity } from '../../../database/entities/safety-alert-review.entity.js';

const DETAIL_DETECTION_LIMIT = 100;
const DETAIL_REVIEW_LIMIT = 100;

export interface SafetyAlertListFilters {
  status?: string;
  type?: string;
}

export interface SafetyAlertDetectionSummary {
  eventId: string;
  cameraExternalId: string;
  capturedAt: Date;
  processingStatus: EventProcessingStatus;
}

export interface SafetyAlertDetail {
  alert: SafetyAlertEntity;
  detections: SafetyAlertDetectionSummary[];
  detectionsTotal: number;
  reviews: SafetyAlertReviewEntity[];
  reviewsTotal: number;
}

function optionalEnum<T extends string>(
  value: string | undefined,
  values: readonly T[],
  label: string,
): T | undefined {
  if (value === undefined) return undefined;
  if ((values as readonly string[]).includes(value)) return value as T;
  return invalid(`Invalid ${label} filter`);
}

@Injectable()
export class SafetyAlertQueryService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    siteId: string,
    offset = 0,
    limit = 20,
    filters: SafetyAlertListFilters = {},
  ): Promise<{ items: SafetyAlertEntity[]; total: number }> {
    const scope = uuid(siteId);
    const pagination = page(offset, limit);
    const status = optionalEnum(filters.status, Object.values(AlertStatus), 'alert status');
    const alertType = optionalEnum(filters.type, Object.values(AlertType), 'alert type');
    const [items, total] = await this.dataSource.getRepository(SafetyAlertEntity).findAndCount({
      where: {
        siteId: scope,
        ...(status === undefined ? {} : { status }),
        ...(alertType === undefined ? {} : { alertType }),
      },
      order: { lastDetectedAt: 'DESC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items, total };
  }

  async get(siteId: string, alertId: string): Promise<SafetyAlertDetail> {
    const scope = uuid(siteId);
    const id = uuid(alertId);
    const alert = await this.dataSource
      .getRepository(SafetyAlertEntity)
      .findOneBy({ id, siteId: scope });
    if (!alert) return missing();

    const mappings = this.dataSource.getRepository(AlertDetectionMappingEntity);
    const reviews = this.dataSource.getRepository(SafetyAlertReviewEntity);
    const [detections, detectionsTotal, reviewItems, reviewsTotal] = await Promise.all([
      mappings
        .createQueryBuilder('mapping')
        .innerJoin(AiObservationEventEntity, 'event', 'event.eventId = mapping.eventId')
        .select('event.eventId', 'eventId')
        .addSelect('event.cameraExternalId', 'cameraExternalId')
        .addSelect('event.capturedAt', 'capturedAt')
        .addSelect('event.processingStatus', 'processingStatus')
        .where('mapping.alertId = :alertId', { alertId: id })
        .orderBy('event.capturedAt', 'DESC')
        .addOrderBy('event.eventId', 'ASC')
        .limit(DETAIL_DETECTION_LIMIT)
        .getRawMany<{
          eventId: string;
          cameraExternalId: string;
          capturedAt: Date;
          processingStatus: EventProcessingStatus;
        }>(),
      mappings.countBy({ alertId: id }),
      reviews.find({
        where: { alertId: id, siteId: scope },
        order: { createdAt: 'ASC', id: 'ASC' },
        take: DETAIL_REVIEW_LIMIT,
      }),
      reviews.countBy({ alertId: id, siteId: scope }),
    ]);
    return { alert, detections, detectionsTotal, reviews: reviewItems, reviewsTotal };
  }
}
