import { safetyTeamZoneContextSql } from '../../workforce/management/safety-work-context.service.js';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { invalid, missing, page, uuid } from '../../../common/configuration/commands.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../../../database/entities/alert-detection-mapping.entity.js';
import { AlertStatus, AlertType, EventProcessingStatus } from '../../../database/entities/enums.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import { SafetyAlertReviewEntity } from '../../../database/entities/safety-alert-review.entity.js';
import {
  SafetyAlertEvidenceService,
  type SafetyAlertEvidenceSummary,
} from './safety-alert-evidence.service.js';

export const attentionAlertSql = `a.status IN ('PENDING_REVIEW','CONFIRMED') AND NOT EXISTS(SELECT 1 FROM incident i WHERE i.id=a.incident_id AND i.site_id=a.site_id AND i.status='CLOSED')`;
const DETAIL_DETECTION_LIMIT = 100;
const DETAIL_REVIEW_LIMIT = 100;

export interface SafetyAlertListFilters {
  contextTeamId?: string;
  attentionOnly?: boolean;
  zoneId?: string;
  cameraExternalId?: string;
  capturedFrom?: string;
  capturedUntil?: string;
  status?: string;
  type?: string;
}

export interface SafetyAlertDetectionSummary {
  eventId: string;
  cameraExternalId: string;
  capturedAt: Date;
  processingStatus: EventProcessingStatus;
  evidence: SafetyAlertEvidenceSummary[];
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
  constructor(
    private readonly dataSource: DataSource,
    private readonly evidence: SafetyAlertEvidenceService,
  ) {}

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
    if (filters.contextTeamId) {
      uuid(filters.contextTeamId);
      if (!filters.capturedFrom || !filters.capturedUntil)
        invalid('Team context requires an observation time interval');
    }
    if (filters.attentionOnly !== undefined && typeof filters.attentionOnly !== 'boolean')
      invalid('Invalid attention filter');
    if (
      filters.contextTeamId ||
      filters.attentionOnly ||
      filters.zoneId ||
      filters.cameraExternalId ||
      filters.capturedFrom ||
      filters.capturedUntil
    ) {
      if (filters.zoneId) uuid(filters.zoneId);
      if (
        filters.cameraExternalId &&
        (filters.cameraExternalId.length > 128 ||
          !filters.cameraExternalId.trim() ||
          Array.from(filters.cameraExternalId).some((c) => c.charCodeAt(0) < 32))
      )
        invalid('Invalid camera filter');
      for (const v of [filters.capturedFrom, filters.capturedUntil])
        if (
          v &&
          (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
            !Number.isFinite(Date.parse(v)))
        )
          invalid('Invalid observation time filter');
      if (
        filters.capturedFrom &&
        filters.capturedUntil &&
        new Date(filters.capturedFrom) >= new Date(filters.capturedUntil)
      )
        invalid('Invalid observation time interval');
      const q = this.dataSource
        .getRepository(SafetyAlertEntity)
        .createQueryBuilder('a')
        .where('a.siteId=:siteId', { siteId: scope });
      if (filters.attentionOnly) q.andWhere(attentionAlertSql);
      if (status) q.andWhere('a.status=:status', { status });
      if (alertType) q.andWhere('a.alertType=:type', { type: alertType });
      if (filters.zoneId) q.andWhere('a.zoneId=:zoneId', { zoneId: filters.zoneId });
      if (filters.cameraExternalId || filters.capturedFrom || filters.capturedUntil) {
        const clauses = ['map.alert_id=a.id'];
        if (filters.contextTeamId)
          clauses.push(
            `EXISTS(SELECT 1 FROM ${safetyTeamZoneContextSql} g WHERE g.site_id=a.site_id AND g.team_id=:contextTeamId AND g.zone_id=a.zone_id AND g.valid_from<=event.captured_at AND g.valid_until>event.captured_at)`,
          );
        if (filters.cameraExternalId) clauses.push('event.camera_external_id=:cameraExternalId');
        if (filters.capturedFrom) clauses.push('event.captured_at>=:capturedFrom');
        if (filters.capturedUntil) clauses.push('event.captured_at<:capturedUntil');
        q.andWhere(
          'EXISTS(SELECT 1 FROM alert_detection_mapping map JOIN ai_observation_event event ON event.event_id=map.event_id WHERE ' +
            clauses.join(' AND ') +
            ')',
          filters,
        );
      }
      const [items, total] = await q
        .orderBy('a.lastDetectedAt', 'DESC')
        .addOrderBy('a.id', 'ASC')
        .skip(pagination.offset)
        .take(pagination.limit)
        .getManyAndCount();
      return { items, total };
    }

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
    const [detectionRows, detectionsTotal, reviewItems, reviewsTotal] = await Promise.all([
      mappings
        .createQueryBuilder('mapping')
        .innerJoin(AiObservationEventEntity, 'event', 'event.eventId = mapping.eventId')
        .select('event.eventId', 'eventId')
        .addSelect('event.cameraExternalId', 'cameraExternalId')
        .addSelect('event.capturedAt', 'capturedAt')
        .addSelect('event.processingStatus', 'processingStatus')
        .addSelect('event.rawPayload', 'rawPayload')
        .where('mapping.alertId = :alertId', { alertId: id })
        .orderBy('event.capturedAt', 'DESC')
        .addOrderBy('event.eventId', 'ASC')
        .limit(DETAIL_DETECTION_LIMIT)
        .getRawMany<{
          eventId: string;
          cameraExternalId: string;
          capturedAt: Date;
          processingStatus: EventProcessingStatus;
          rawPayload: unknown;
        }>(),
      mappings.countBy({ alertId: id }),
      reviews.find({
        where: { alertId: id, siteId: scope },
        order: { createdAt: 'ASC', id: 'ASC' },
        take: DETAIL_REVIEW_LIMIT,
      }),
      reviews.countBy({ alertId: id, siteId: scope }),
    ]);
    const detections = detectionRows.map(({ rawPayload, ...detection }) => ({
      ...detection,
      evidence: this.evidence.summarize(rawPayload, detection.eventId),
    }));
    return { alert, detections, detectionsTotal, reviews: reviewItems, reviewsTotal };
  }
}
