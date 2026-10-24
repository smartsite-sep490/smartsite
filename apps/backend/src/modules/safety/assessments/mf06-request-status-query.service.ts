import { readMf06Snapshot } from './mf06-read-snapshot.js';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../../../config/environment.js';
import {
  parseMf06RequestStatusResponse,
  type Mf06RequestStatusPage,
  type Mf06RequestStatusResponse,
} from '@smartsite/contracts';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { page, uuid, missing } from '../../../common/configuration/commands.js';
import { Mf06AssessmentStore } from './mf06-assessment-store.service.js';

type StatusRow = Record<string, unknown>;
const timestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** Read-only persisted job state. Does not claim, enqueue, retry or start an evaluator. */
@Injectable()
export class Mf06RequestStatusQueryService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}

  async list(siteId: string, offset = 0, limit = 20): Promise<Mf06RequestStatusPage> {
    const scope = uuid(siteId).toLowerCase(),
      paging = page(offset, limit);
    return this.snapshot(scope, async (manager) => {
      const [count] = await manager.query(
        `SELECT count(*)::text AS total ${this.from()} WHERE r.site_id=$1 AND ${this.visible()}`,
        [scope],
      );
      const total = Number(count?.total);
      if (!Number.isSafeInteger(total) || total < 0) throw this.unavailable();
      const rows = (await manager.query(
        `${this.select()} WHERE r.site_id=$1 AND ${this.visible()} ORDER BY r.captured_at DESC,r.request_id DESC OFFSET $2 LIMIT $3`,
        [scope, paging.offset, paging.limit],
      )) as StatusRow[];
      const items: Mf06RequestStatusResponse[] = [];
      for (const row of rows) items.push(await this.project(manager, scope, row));
      return { items, total, ...paging };
    });
  }

  async get(siteId: string, requestId: string): Promise<Mf06RequestStatusResponse> {
    const scope = uuid(siteId).toLowerCase(),
      id = uuid(requestId).toLowerCase();
    return this.snapshot(scope, async (manager) => {
      const rows = (await manager.query(
        `${this.select()} WHERE r.site_id=$1 AND r.request_id=$2 AND ${this.visible()}`,
        [scope, id],
      )) as StatusRow[];
      if (!rows[0]) return missing();
      return this.project(manager, scope, rows[0]);
    });
  }

  private from() {
    return 'FROM zone_entry_assessment_request r LEFT JOIN zone_entry_assessment_job j ON j.request_id=r.request_id LEFT JOIN zone_entry_assessment a ON a.request_id=r.request_id';
  }
  private visible() {
    return "(a.assessment_id IS NULL OR a.provenance<>'SYNTHETIC_TEST')";
  }
  private select() {
    return `SELECT r.request_id,r.site_id,r.event_id,r.camera_id,r.zone_id,r.requested_purpose,
      ${timestamp('r.captured_at')} AS captured_at,${timestamp('r.requested_at')} AS requested_at,
      j.request_id AS job_request_id,j.status,j.attempt_count,${timestamp('j.deadline_at')} AS deadline_at,
      COALESCE(j.deadline_at<transaction_timestamp(),false) AS deadline_passed,a.assessment_id ${this.from()}`;
  }

  private async project(manager: EntityManager, scope: string, row: StatusRow) {
    const status = row.job_request_id === null ? 'NOT_QUEUED' : row.status;
    if (status === 'SUCCEEDED') {
      if (typeof row.assessment_id !== 'string') throw this.unavailable();
      const record = await new Mf06AssessmentStore(this.db).readRecordedInTransaction(
        manager,
        scope,
        row.assessment_id,
      );
      if (!record || record.requestId !== row.request_id) throw this.unavailable();
    } else if (row.assessment_id !== null) throw this.unavailable();
    try {
      return parseMf06RequestStatusResponse({
        requestId: row.request_id,
        siteId: row.site_id,
        eventId: row.event_id,
        cameraId: row.camera_id,
        zoneId: row.zone_id,
        capturedAt: row.captured_at,
        requestedAt: row.requested_at,
        purpose: row.requested_purpose,
        jobStatus: status,
        attemptCount: row.attempt_count,
        deadlineAt: row.deadline_at,
        deadlinePassed: row.deadline_passed,
        assessmentId: row.assessment_id,
      });
    } catch {
      throw this.unavailable();
    }
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
        'zone_entry_assessment_request',
        'zone_entry_assessment_job',
        'zone_entry_assessment',
        'zone_entry_authority_artifact',
      ],
      operation,
      () => this.unavailable(),
    );
  }
  private unavailable() {
    return new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Assessment request status is unavailable',
    });
  }
}
