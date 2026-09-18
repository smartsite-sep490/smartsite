import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import { computeCanonicalPayloadHash, validateObservationEvent } from '@smartsite/contracts';
import { EventProcessingStatus } from '../../database/entities/enums.js';
import { AiObservationEventEntity } from '../../database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../../database/entities/alert-detection-mapping.entity.js';
import {
  ObservationContextResolverService,
  type ResolvedObservationContext,
} from '../../modules/zones/observation-context-resolver.service.js';
import {
  AlertCandidateEvaluator,
  type AlertCandidate,
  type Observation,
} from '../../modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../modules/safety/alerts/durable-grouping.service.js';

export interface AiIngestionResult {
  eventId: string;
  status: EventProcessingStatus | 'DUPLICATE_ACCEPTED';
  alertIds: string[];
}

interface ValidatedObservationEvent {
  eventId: string;
  schemaVersion: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  frameDimensions: { width: number; height: number };
  observations: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
}

/**
 * Normalizes an RFC 3339 date-time string into a valid ECMAScript Date.
 * RFC 3339 allows leap seconds (:60), e.g. '2026-12-31T23:59:60Z' or '2026-12-31T23:59:60.123+02:00'.
 * ECMAScript Date returns NaN for seconds = 60.
 * Following POSIX/Unix timestamp standard, the leap second is mapped to :59 of the same second,
 * ensuring valid Date arithmetic and PostgreSQL timestamptz persistence while preserving the
 * exact original string in rawPayload and canonical payloadHash (Spec §15).
 */
export function parseNormalizedCapturedAt(dateString: string): Date {
  const leapSecondRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):60(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i;
  const match = dateString.match(leapSecondRegex);
  if (match) {
    const prefix = match[1];
    const fraction = match[2] ?? '';
    const timezone = match[3] ?? '';
    return new Date(`${prefix}:59${fraction}${timezone}`);
  }
  return new Date(dateString);
}

@Injectable()
export class AiIngestionService {
  private readonly clock: () => Date;

  constructor(
    private readonly dataSource: DataSource,
    private readonly contextResolver: ObservationContextResolverService,
    private readonly candidateEvaluator: AlertCandidateEvaluator,
    private readonly durableGroupingService: DurableGroupingService,
    private readonly configService?: ConfigService,
    @Optional() clock?: () => Date,
  ) {
    this.clock = clock ?? (() => new Date());
  }

  private getTimingConfig() {
    const pastAge = this.configService?.get<number>('MAX_PAST_EVENT_AGE_SECONDS');
    const futureSkew = this.configService?.get<number>('MAX_FUTURE_CLOCK_SKEW_SECONDS');
    return {
      maxPastEventAgeSeconds: typeof pastAge === 'number' && pastAge > 0 ? pastAge : 300,
      maxFutureClockSkewSeconds: typeof futureSkew === 'number' && futureSkew > 0 ? futureSkew : 30,
    };
  }

  async ingestEvent(payload: unknown): Promise<AiIngestionResult> {
    // 1. Validate contract schema and semantic geometry (Spec §15.1, §16)
    const validationResult = validateObservationEvent(payload);
    if (!validationResult.isValid) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: validationResult.issues,
      });
    }

    const event = payload as ValidatedObservationEvent;

    // 2. Compute canonical RFC 8785 JCS payload hash on the original raw payload
    const payloadHash = computeCanonicalPayloadHash(payload);

    // 3. Evaluate clock skew using normalized Date (supports RFC 3339 leap seconds)
    const now = this.clock();
    const capturedAt = parseNormalizedCapturedAt(event.capturedAt);
    const capturedMs = capturedAt.getTime();
    const nowMs = now.getTime();
    const { maxPastEventAgeSeconds, maxFutureClockSkewSeconds } = this.getTimingConfig();
    const minAllowedMs = nowMs - maxPastEventAgeSeconds * 1000;
    const maxAllowedMs = nowMs + maxFutureClockSkewSeconds * 1000;

    const isClockSkew = capturedMs < minAllowedMs || capturedMs > maxAllowedMs;

    // 4. Same-transaction context resolution, raw preservation, and alert grouping
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const camera = await this.contextResolver.resolveCamera(manager, event.cameraExternalId);

      let status: EventProcessingStatus;
      let note: string | null = null;
      let candidates: AlertCandidate[] = [];

      // Status precedence:
      // 1. clock skew outside allowed window -> SKIPPED_CLOCK_SKEW
      // 2. otherwise unknown camera -> SKIPPED_UNKNOWN_CAMERA
      // 3. otherwise no valid candidate/context -> SKIPPED_NO_CANDIDATE
      // 4. otherwise -> PROCESSED
      if (isClockSkew) {
        status = EventProcessingStatus.SKIPPED_CLOCK_SKEW;
        note = 'Event capturedAt is outside the allowed clock skew window';
      } else if (!camera) {
        status = EventProcessingStatus.SKIPPED_UNKNOWN_CAMERA;
        note = 'Camera external ID not found or inactive';
      } else {
        // Resolve context per observation regionId & geometryVersion
        const contextMap = new Map<string, ResolvedObservationContext>();
        for (const obs of event.observations) {
          if (
            obs &&
            typeof obs === 'object' &&
            typeof obs['regionId'] === 'string' &&
            typeof obs['geometryVersion'] === 'number'
          ) {
            const key = `${obs['regionId']}:${obs['geometryVersion']}`;
            if (!contextMap.has(key)) {
              const ctx = await this.contextResolver.resolve(
                manager,
                event.cameraExternalId,
                obs['regionId'],
                obs['geometryVersion'],
              );
              if (ctx) {
                contextMap.set(key, ctx);
              }
            }
          }
        }

        candidates = this.candidateEvaluator.evaluate(
          {
            streamSessionId: event.streamSessionId,
            cameraExternalId: event.cameraExternalId,
            observations: event.observations as unknown as Observation[],
          },
          contextMap,
        );

        if (candidates.length === 0) {
          status = EventProcessingStatus.SKIPPED_NO_CANDIDATE;
          note = 'No safety violation candidates detected';
        } else {
          status = EventProcessingStatus.PROCESSED;
        }
      }

      // Spec §15.3: Raw Event insert MUST occur before any Alert side effects
      const rawEventRepo = manager.getRepository(AiObservationEventEntity);
      const rawEvent = rawEventRepo.create({
        eventId: event.eventId,
        payloadHash,
        cameraExternalId: event.cameraExternalId,
        resolvedCameraId: camera ? camera.id : null,
        streamSessionId: event.streamSessionId,
        capturedAt,
        receivedAt: now,
        rawPayload: event,
        processingStatus: status,
        processingNote: note,
      });
      await rawEventRepo.insert(
        rawEvent as unknown as QueryDeepPartialEntity<AiObservationEventEntity>,
      );

      // Group candidates and create AlertDetectionMapping only when PROCESSED
      const alertIds: string[] = [];
      if (status === EventProcessingStatus.PROCESSED && camera) {
        for (const candidate of candidates) {
          const alert = await this.durableGroupingService.groupCandidate(
            manager,
            camera.siteId,
            candidate,
            capturedAt,
          );
          alertIds.push(alert.id);
        }

        const uniqueAlertIds = Array.from(new Set(alertIds));
        const mappingRepo = manager.getRepository(AlertDetectionMappingEntity);
        for (const alertId of uniqueAlertIds) {
          await mappingRepo.insert({
            alertId,
            eventId: event.eventId,
          });
        }
      }

      return {
        eventId: event.eventId,
        status,
        alertIds: Array.from(new Set(alertIds)),
      };
    });
  }
}
