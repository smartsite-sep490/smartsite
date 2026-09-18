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
 * RFC 3339 allows:
 * 1. Bare-hour timezone offsets (+HH or -HH), e.g. '+00', '-05'.
 *    ECMAScript Date requires minute precision in timezone offsets (+HH:mm or -HH:mm).
 * 2. Leap seconds (:60), e.g. '2026-12-31T23:59:60Z' or '2026-12-31T23:59:60+00'.
 *    ECMAScript Date returns NaN for seconds = 60.
 *
 * This function:
 * 1. Normalizes bare-hour offsets to +HH:00 / -HH:00.
 * 2. Normalizes leap seconds (:60) to :59 of the same second (POSIX/Unix timestamp standard).
 * 3. Returns a valid Date if the normalized string yields a finite timestamp, or null otherwise.
 *
 * Spec §15 requirement: The exact original payload and canonical RFC 8785 payloadHash
 * must remain untouched, preserving raw evidence while storing a safe, queryable
 * timestamptz in PostgreSQL.
 */
export function parseNormalizedCapturedAt(dateString: string): Date | null {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }

  let normalized = dateString.trim();

  // 1. Normalize bare-hour timezone offset (+HH or -HH) at end of string to +HH:00 or -HH:00
  normalized = normalized.replace(/([+-]\d{2})$/, '$1:00');

  // 2. Normalize RFC 3339 leap second (:60) to :59
  normalized = normalized.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}):60(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/i,
    (_match, prefix, fraction, tz) => `${prefix}:59${fraction ?? ''}${tz ?? ''}`,
  );

  const parsed = new Date(normalized);
  if (Number.isFinite(parsed.getTime())) {
    return parsed;
  }

  return null;
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

    // 3. Evaluate clock skew using normalized Date (supports RFC 3339 leap seconds & bare-hour offsets)
    const now = this.clock();
    const parsedCapturedAt = parseNormalizedCapturedAt(event.capturedAt);

    let capturedAt: Date;
    let isClockSkew: boolean;
    let unparseableDateNote: string | null = null;

    if (!parsedCapturedAt) {
      // Finite-Date guard: if a schema-valid date cannot be normalized to a finite Date,
      // preserve raw event safely by falling back to now for DB timestamptz and skipping grouping (Spec §15.1/§15.2).
      capturedAt = now;
      isClockSkew = true;
      unparseableDateNote =
        'Schema-valid event capturedAt unparseable as finite timestamp; raw payload preserved';
    } else {
      capturedAt = parsedCapturedAt;
      const capturedMs = capturedAt.getTime();
      const nowMs = now.getTime();
      const { maxPastEventAgeSeconds, maxFutureClockSkewSeconds } = this.getTimingConfig();
      const minAllowedMs = nowMs - maxPastEventAgeSeconds * 1000;
      const maxAllowedMs = nowMs + maxFutureClockSkewSeconds * 1000;

      isClockSkew = capturedMs < minAllowedMs || capturedMs > maxAllowedMs;
    }

    // 4. Same-transaction context resolution, raw preservation, and alert grouping
    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const camera = await this.contextResolver.resolveCamera(manager, event.cameraExternalId);

      let status: EventProcessingStatus;
      let note: string | null = null;
      let candidates: AlertCandidate[] = [];

      // Status precedence:
      // 1. clock skew outside allowed window (or unparseable timestamp) -> SKIPPED_CLOCK_SKEW
      // 2. otherwise unknown camera -> SKIPPED_UNKNOWN_CAMERA
      // 3. otherwise no valid candidate/context -> SKIPPED_NO_CANDIDATE
      // 4. otherwise -> PROCESSED
      if (isClockSkew) {
        status = EventProcessingStatus.SKIPPED_CLOCK_SKEW;
        note = unparseableDateNote ?? 'Event capturedAt is outside the allowed clock skew window';
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
