import { readMf06Snapshot } from './mf06-read-snapshot.js';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../../../config/environment.js';
import type { Mf06AssessmentPage, Mf06AssessmentResponse } from '@smartsite/contracts';
import { parseMf06AssessmentResponse } from '@smartsite/contracts';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { page, uuid, missing } from '../../../common/configuration/commands.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { ZoneEntryAssessmentRequestEntity } from '../../../database/entities/zone-entry-assessment-request.entity.js';
import {
  Mf06AssessmentStore,
  type Mf06RecordedAssessment,
} from './mf06-assessment-store.service.js';
import { selectMf06FrameReference } from './mf06-frame-reference.js';
import { readMf06FrameMedia, type Mf06VerifiedFrameMedia } from './mf06-frame-media.reader.js';
import { inspectMf06StoredBinding } from './mf06-request-context.js';
import { readMf06FrameDeliveries } from './mf06-frame-delivery.js';

export interface Mf06ExpectedFrameBinding {
  readonly requestId: string;
  readonly eventId: string;
}

const SNAPSHOT_RELATIONS = [
  'site',
  'zone_entry_assessment',
  'zone_entry_authority_artifact',
  'zone_entry_assessment_request',
  'ai_observation_event',
] as const;

const FRAME_SNAPSHOT_RELATIONS = SNAPSHOT_RELATIONS;

@Injectable()
export class Mf06AssessmentQueryService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}
  async list(siteId: string, offset = 0, limit = 20): Promise<Mf06AssessmentPage> {
    const scope = uuid(siteId).toLowerCase(),
      pagination = page(offset, limit);
    return this.snapshot(scope, async (manager) => {
      const [count] = await manager.query(
        "SELECT count(*)::text AS total FROM zone_entry_assessment WHERE site_id=$1 AND provenance<>'SYNTHETIC_TEST'",
        [scope],
      );
      const total = Number(count?.total);
      if (!Number.isSafeInteger(total) || total < 0) throw this.unavailable();
      const rows = (await manager.query(
        "SELECT assessment_id FROM zone_entry_assessment WHERE site_id=$1 AND provenance<>'SYNTHETIC_TEST' ORDER BY assessed_at DESC,assessment_id ASC OFFSET $2 LIMIT $3",
        [scope, pagination.offset, pagination.limit],
      )) as { assessment_id: string }[];
      const store = new Mf06AssessmentStore(this.db),
        items: Mf06AssessmentResponse[] = [];
      for (const row of rows) {
        const record = await store.readRecordedInTransaction(manager, scope, row.assessment_id);
        if (!record) throw this.unavailable();
        items.push(this.project(record));
      }
      return { items: await this.deliveries(manager, items), total, ...pagination };
    });
  }
  async get(siteId: string, assessmentId: string): Promise<Mf06AssessmentResponse> {
    const scope = uuid(siteId).toLowerCase(),
      id = uuid(assessmentId).toLowerCase();
    return this.snapshot(scope, async (manager) => {
      const record = await new Mf06AssessmentStore(this.db).readRecordedInTransaction(
        manager,
        scope,
        id,
      );
      if (!record) return missing();
      const [item] = await this.deliveries(manager, [this.project(record)]);
      if (!item) throw this.unavailable();
      return item;
    });
  }

  /**
   * Resolves the immutable assessment -> request -> raw event -> FRAME SHA binding inside
   * the scoped repeatable-read snapshot, then reads and verifies bounded JPEG bytes outside
   * database locks. Never invents an accepted frame SHA when the event lacks one.
   */
  async readFrame(
    siteId: string,
    assessmentId: string,
    expected: Mf06ExpectedFrameBinding,
  ): Promise<Mf06VerifiedFrameMedia> {
    const scope = uuid(siteId).toLowerCase(),
      id = uuid(assessmentId).toLowerCase(),
      expectedRequestId = uuid(expected.requestId).toLowerCase(),
      expectedEventId = uuid(expected.eventId).toLowerCase();

    const { record, frameReference } = await this.snapshot(
      scope,
      async (manager) => {
        const stored = await new Mf06AssessmentStore(this.db).readRecordedInTransaction(
          manager,
          scope,
          id,
        );
        if (!stored) return missing();
        this.project(stored);
        if (stored.requestId !== expectedRequestId || stored.eventId !== expectedEventId)
          return missing();
        const request = await manager
          .getRepository(ZoneEntryAssessmentRequestEntity)
          .findOneBy({ requestId: stored.requestId, siteId: scope });
        if (!request) return missing();
        const event = await manager
          .getRepository(AiObservationEventEntity)
          .findOneBy({ eventId: stored.eventId });
        if (!event) return missing();
        const inspected = inspectMf06StoredBinding(request, event);
        if (
          inspected.status !== 'MATCHED' ||
          inspected.request.requestId !== stored.requestId ||
          inspected.request.siteId !== stored.siteId ||
          inspected.request.eventId !== stored.eventId ||
          inspected.request.cameraId !== stored.cameraId ||
          inspected.request.zoneId !== stored.zoneId ||
          inspected.request.capturedAt !== new Date(stored.capturedAt).toISOString() ||
          inspected.request.requestedPurpose !== stored.purpose ||
          inspected.request.storedBindingHash !== stored.bindingHash
        )
          return missing();
        const frame = selectMf06FrameReference(event.rawPayload, inspected.request);
        if (!frame || (stored.frameSha256 !== null && stored.frameSha256 !== frame.sha256))
          return missing();
        return { record: stored, frameReference: frame };
      },
      FRAME_SNAPSHOT_RELATIONS,
    );

    const evidenceRoot = this.config.get('EVIDENCE_LOCAL_ROOT', { infer: true });
    if (!evidenceRoot) return missing();
    const media = await readMf06FrameMedia(evidenceRoot, frameReference);
    if (
      !media ||
      media.sha256 !== frameReference.sha256 ||
      (record.frameSha256 !== null && media.sha256 !== record.frameSha256)
    )
      return missing();
    return media;
  }

  private async snapshot<T>(
    scope: string,
    operation: (manager: EntityManager) => Promise<T>,
    relations: readonly string[] = SNAPSHOT_RELATIONS,
  ): Promise<T> {
    if (this.config.get('MF06_ASSESSMENT_READ_ENABLED', { infer: true }) !== true)
      throw this.unavailable();
    return readMf06Snapshot(this.db, scope, relations, operation, () => this.unavailable());
  }
  private project(record: Mf06RecordedAssessment): Mf06AssessmentResponse {
    try {
      return parseMf06AssessmentResponse({
        assessmentId: record.assessmentId,
        requestId: record.requestId,
        siteId: record.siteId,
        eventId: record.eventId,
        cameraId: record.cameraId,
        zoneId: record.zoneId,
        capturedAt: record.capturedAt,
        assessedAt: record.assessedAt,
        purpose: record.purpose,
        outcome: record.outcome,
        reasonCode: record.reasonCode,
        evaluatorVersion: record.evaluatorVersion,
        provenance: record.provenance,
      });
    } catch {
      throw this.unavailable();
    }
  }
  private async deliveries(manager: EntityManager, items: Mf06AssessmentResponse[]) {
    const deliveries = await readMf06FrameDeliveries(manager, items);
    return items.map((item) => {
      const frameDelivery = deliveries.get(item.eventId);
      return frameDelivery ? parseMf06AssessmentResponse({ ...item, frameDelivery }) : item;
    });
  }
  private unavailable() {
    return new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Assessment history is unavailable',
    });
  }
}
