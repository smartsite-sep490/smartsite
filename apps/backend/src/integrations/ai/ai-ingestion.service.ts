import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../config/environment.js';
import { DataSource, type EntityManager, QueryFailedError } from 'typeorm';
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
  summarizeIdentityEvidenceByTrack,
  type AlertCandidate,
  type Observation,
} from '../../modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from '../../modules/safety/alerts/durable-grouping.service.js';
import { isEventIdConflict } from './typeorm-error.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  ZoneEntryAuthorizationService,
  type ZoneEntryDecisionInput,
} from '../../modules/zones/zone-entry-authorization.service.js';
import type { ZoneAuthorizationResult } from '../../modules/zones/zone-authorization.interface.js';
import { parseNormalizedCapturedAt } from '../../common/parse-normalized-captured-at.js';
export { parseNormalizedCapturedAt } from '../../common/parse-normalized-captured-at.js';

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

@Injectable()
export class AiIngestionService {
  private readonly logger = new Logger(AiIngestionService.name);
  private readonly clock: () => Date;
  private readonly zoneEntryAuthorization: ZoneEntryAuthorizationService;

  constructor(
    private readonly dataSource: DataSource,
    private readonly contextResolver: ObservationContextResolverService,
    private readonly candidateEvaluator: AlertCandidateEvaluator,
    private readonly durableGroupingService: DurableGroupingService,
    private readonly configService: ConfigService<BackendEnvironment, true>,
    @Optional() clock?: () => Date,
    @Optional() zoneEntryAuthorization?: ZoneEntryAuthorizationService,
  ) {
    this.clock = clock ?? (() => new Date());
    this.zoneEntryAuthorization = zoneEntryAuthorization ?? new ZoneEntryAuthorizationService();
  }

  private getTimingConfig() {
    return {
      maxPastEventAgeSeconds: this.configService.getOrThrow('MAX_PAST_EVENT_AGE_SECONDS', {
        infer: true,
      }),
      maxFutureClockSkewSeconds: this.configService.getOrThrow('MAX_FUTURE_CLOCK_SKEW_SECONDS', {
        infer: true,
      }),
    };
  }

  async ingestEvent(payload: unknown): Promise<AiIngestionResult> {
    // 1. Validate contract schema and semantic geometry (Spec §15.1, §16)
    const validationResult = validateObservationEvent(payload);
    if (!validationResult.isValid) {
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
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
    try {
      return await this.dataSource.transaction(async (manager: EntityManager) => {
        const camera = await this.contextResolver.resolveCamera(manager, event.cameraExternalId);

        let status: EventProcessingStatus;
        let note: string | null = null;
        let candidates: AlertCandidate[] = [];
        const zoneDecisions: Array<{
          input: ZoneEntryDecisionInput;
          result: ZoneAuthorizationResult;
        }> = [];

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

          const observations = event.observations as unknown as Observation[];
          const identityByTrack = summarizeIdentityEvidenceByTrack(observations);

          const decisionByObservation = new Map<string, ZoneAuthorizationResult>();
          for (const observation of event.observations) {
            if (
              observation['type'] !== 'ZONE_ENTRY' ||
              typeof observation['trackId'] !== 'number' ||
              typeof observation['regionId'] !== 'string' ||
              typeof observation['geometryVersion'] !== 'number'
            ) {
              continue;
            }
            const context = contextMap.get(
              `${observation['regionId']}:${observation['geometryVersion']}`,
            );
            if (!context) continue;
            const input: ZoneEntryDecisionInput = {
              eventId: event.eventId,
              siteId: context.siteId,
              zoneId: context.zoneId,
              candidateWorkerId: identityByTrack.get(observation['trackId'])?.candidateWorkerId,
              trackId: observation['trackId'],
              evaluatedAt: capturedAt,
              restrictionPolicy: context.zone.restrictionPolicy,
            };
            const result = await this.zoneEntryAuthorization.decide(manager, input);
            zoneDecisions.push({ input, result });
            decisionByObservation.set(
              `${input.trackId}:${observation['regionId']}:${observation['geometryVersion']}`,
              result,
            );
          }

          candidates = this.candidateEvaluator.evaluate(
            {
              streamSessionId: event.streamSessionId,
              cameraExternalId: event.cameraExternalId,
              observations,
            },
            contextMap,
            ({ trackId, regionId, geometryVersion }) =>
              decisionByObservation.get(`${trackId}:${regionId}:${geometryVersion}`) ?? {
                status: 'UNAVAILABLE',
                candidateSubtype: 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
                reasonCode: 'AUTHORIZATION_DATA_UNAVAILABLE',
                reason: 'Zone authorization decision is unavailable',
              },
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

        for (const decision of zoneDecisions) {
          await this.zoneEntryAuthorization.record(manager, decision.input, decision.result);
        }

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
    } catch (error) {
      if (isEventIdConflict(error)) {
        const existing = await this.dataSource
          .getRepository(AiObservationEventEntity)
          .findOneBy({ eventId: event.eventId });

        if (existing) {
          if (existing.payloadHash === payloadHash) {
            // Spec §15: Same hash -> 202 response DUPLICATE_ACCEPTED with no alert side effect
            return {
              eventId: event.eventId,
              status: 'DUPLICATE_ACCEPTED',
              alertIds: [],
            };
          }

          // Spec §15: Changed hash for existing eventId -> stable public 409 conflict
          throw new PublicHttpException(HttpStatus.CONFLICT, {
            code: 'AI_EVENT_ID_CONFLICT',
            message: 'Event ID already exists with a different payload',
          });
        }
      }

      if (error instanceof QueryFailedError) {
        const driverError = error.driverError as
          { code?: unknown; constraint?: unknown } | undefined;
        const code = typeof driverError?.code === 'string' ? driverError.code : 'UNKNOWN';
        const rawConstraint = driverError?.constraint;
        const constraint =
          typeof rawConstraint === 'string' && /^[A-Za-z0-9_]{1,128}$/.test(rawConstraint)
            ? rawConstraint
            : 'UNKNOWN';

        this.logger.error({
          message: 'AI ingestion persistence failed',
          eventId: event.eventId,
          code,
          constraint,
        });
        throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
          code: 'AI_INGESTION_UNAVAILABLE',
          message: 'AI ingestion is temporarily unavailable',
        });
      }

      // Every other error rethrow
      throw error;
    }
  }
}
