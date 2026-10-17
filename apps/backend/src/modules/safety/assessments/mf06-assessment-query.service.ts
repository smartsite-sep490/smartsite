import { readMf06Snapshot } from './mf06-read-snapshot.js';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../../../config/environment.js';
import type { Mf06AssessmentPage, Mf06AssessmentResponse } from '@smartsite/contracts';
import { parseMf06AssessmentResponse } from '@smartsite/contracts';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { page, uuid, missing } from '../../../common/configuration/commands.js';
import {
  Mf06AssessmentStore,
  type Mf06RecordedAssessment,
} from './mf06-assessment-store.service.js';
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
      return { items, total, ...pagination };
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
      return this.project(record);
    });
  }
  private async snapshot<T>(
    scope: string,
    operation: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (this.config.get('MF06_ASSESSMENT_READ_ENABLED', { infer: true }) !== true)
      throw this.unavailable();
    return readMf06Snapshot(
      this.db,
      scope,
      [
        'site',
        'zone_entry_assessment',
        'zone_entry_authority_artifact',
        'zone_entry_assessment_request',
      ],
      operation,
      () => this.unavailable(),
    );
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
  private unavailable() {
    return new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Assessment history is unavailable',
    });
  }
}
