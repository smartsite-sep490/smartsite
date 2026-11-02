import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import type { BackendEnvironment } from '../../../config/environment.js';
import {
  isTrackedProjectionTransaction,
  type TrackedProjectionFrame,
  type TrackedProjectionPort,
} from '../../../integrations/ai/tracked-frame-admission.js';
import { Mf06IngestionEnqueueService } from '../assessments/mf06-ingestion-enqueue.service.js';
import { TrackedPpeInboxProjection } from './tracked-ppe-inbox-projection.js';

/** Unregistered composition for the admission owner's transaction, not a worker launcher. */
export class TrackedSafetyProjection implements TrackedProjectionPort {
  private readonly inbox: TrackedPpeInboxProjection;
  private readonly assessments: Mf06IngestionEnqueueService;

  constructor(
    db: DataSource,
    config: ConfigService<BackendEnvironment, true>,
    policy: { maxRecipients: number },
  ) {
    this.inbox = new TrackedPpeInboxProjection(db, policy);
    this.assessments = new Mf06IngestionEnqueueService(db, config);
  }

  async project(manager: EntityManager, frame: TrackedProjectionFrame): Promise<void> {
    if (!isTrackedProjectionTransaction(manager, frame))
      throw new Error('TRACKED_PROJECTION_TRANSACTION_REQUIRED');
    await this.inbox.projectFrame(manager, {
      siteId: frame.scope.siteId,
      cameraId: frame.scope.cameraId,
      scopeSha256: frame.scope.scopeSha256,
      coordinatorEventId: frame.coordinatorEventId,
    });
    await this.assessments.enqueueSealedFrame(manager, frame);
  }
}
