import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../../../config/environment.js';
import type { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { EventProcessingStatus } from '../../../database/entities/enums.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { Mf06EnqueueService } from './mf06-enqueue.service.js';

@Injectable()
export class Mf06IngestionEnqueueService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}

  async enqueueFresh(
    manager: EntityManager,
    event: AiObservationEventEntity,
  ): Promise<readonly string[]> {
    if (this.config.get('MF06_ENQUEUE_ENABLED', { infer: true }) !== true) return [];
    const cap = this.config.get('MF06_ENQUEUE_MAX_OUTSTANDING', { infer: true });
    if (!Number.isSafeInteger(cap) || cap === undefined || cap < 1 || cap > 10000) {
      throw this.unavailable();
    }
    if (
      manager.connection !== this.db ||
      !manager.queryRunner?.isTransactionActive ||
      manager.queryRunner.isReleased
    ) {
      throw this.unavailable();
    }
    if (
      !event.resolvedCameraId ||
      ![EventProcessingStatus.PROCESSED, EventProcessingStatus.SKIPPED_NO_CANDIDATE].includes(
        event.processingStatus,
      )
    )
      return [];
    const raw = event.rawPayload as { observations?: unknown[] };
    if (
      !Array.isArray(raw?.observations) ||
      !raw.observations.some(
        (item) =>
          item && typeof item === 'object' && (item as { type?: unknown }).type === 'ZONE_ENTRY',
      )
    )
      return [];

    // Schema-wide capacity requires a schema-wide writer lock until COMMIT. A losing
    // intake returns503 for retry; releasing early or locking per Site would race the cap.
    const [lock] = await manager.query(
      "SELECT pg_try_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':mf06-enqueue-v1')) AS acquired",
    );
    if (lock?.acquired !== true) throw this.unavailable();
    const ids = await new Mf06EnqueueService(this.db).enqueueFresh(manager, event);
    if (ids.length === 0) return ids;
    // Expired nonterminal work still occupies capacity until an explicit worker
    // transition. Limit the count read; do not purge history or partially accept an event.
    const [row] = await manager.query(
      "SELECT count(*)::integer AS total FROM (SELECT request_id FROM zone_entry_assessment_job WHERE status IN ('PENDING','CLAIMED') LIMIT $1) outstanding",
      [cap + 1],
    );
    if (!Number.isSafeInteger(row?.total) || row.total > cap) throw this.unavailable();
    return ids;
  }

  private unavailable() {
    return new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
      code: 'AI_INGESTION_UNAVAILABLE',
      message: 'AI ingestion is temporarily unavailable',
    });
  }
}
