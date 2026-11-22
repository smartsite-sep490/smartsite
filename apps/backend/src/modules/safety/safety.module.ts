import { Mf06AssessmentWorkerRuntime } from './assessments/mf06-assessment-worker-runtime.service.js';
import { SafetyChecklistService } from './safety-checklist.service.js';
import { SafetyIdentificationController } from './identification/safety-identification.controller.js';
import { SafetyIdentificationService } from './identification/safety-identification.service.js';
import { SafetyIdentificationRuntime } from './identification/safety-identification-runtime.js';
import { SafetyIdentificationEnabledGuard } from './identification/safety-identification-enabled.guard.js';
import { SafetyChecklistController } from './safety-checklist.controller.js';
import { SafetyOverviewService } from './safety-overview.service.js';
import { SafetyOverviewController } from './safety-overview.controller.js';
import { CamerasModule } from '../cameras/cameras.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { StorageService } from '../../integrations/storage/storage.service.js';
import { readMf06FrameMedia, readMf06SubjectMedia } from './assessments/mf06-frame-media.reader.js';
import { UsersModule } from '../users/users.module.js';
import { SafetyWorkflowService } from './safety-workflow.service.js';
import { SafetyWorkflowController } from './safety-workflow.controller.js';
import { SafetyUploadService } from './safety-upload.service.js';
import { Mf06IngestionEnqueueService } from './assessments/mf06-ingestion-enqueue.service.js';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../config/environment.js';
import { UserAuthGuard } from '../auth/user-auth.guard.js';
import { TrackedEpisodeFrameQuery } from './alerts/tracked-episode-frame-query.js';
import { TrackedEpisodeFramesController } from './alerts/tracked-episode-frames.controller.js';
import { SafetyEpisodeInboxController } from './alerts/safety-episode-inbox.controller.js';
import { SafetyEpisodeInboxService } from './alerts/safety-episode-inbox.service.js';
import { SafetyEpisodeQueryService } from './alerts/safety-episode-query.service.js';
import { SafetyEpisodeProjectionService } from './alerts/safety-episode-projection.service.js';
import { SafetyEpisodesController } from './alerts/safety-episodes.controller.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { AlertCandidateEvaluator } from './alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from './alerts/durable-grouping.service.js';
import { SafetyAlertQueryService } from './alerts/safety-alert-query.service.js';
import { SafetyAlertsController } from './alerts/safety-alerts.controller.js';
import { SafetyAlertAccessGuard } from './alerts/safety-alert-access.guard.js';
import { SafetyAlertReviewService } from './alerts/safety-alert-review.service.js';
import { SafetyAlertEvidenceService } from './alerts/safety-alert-evidence.service.js';
import { WorkforceModule } from '../workforce/workforce.module.js';
import { WorkforceConfigurationService } from '../workforce/directory/workforce-configuration.service.js';
import { ObservationIdentityController } from './identity/observation-identity.controller.js';
import { ObservationIdentityAccessGuard } from './identity/observation-identity-access.guard.js';
import { ObservationIdentityResolutionService } from './identity/observation-identity-resolution.service.js';
import { ObservationIdentityContextService } from './identity/observation-identity-context.service.js';
import {
  WORKER_REFERENCE_READER,
  type WorkerReferenceReader,
} from './identity/worker-reference.port.js';
import { DataSource } from 'typeorm';
import { ZoneAccessManagementService } from '../zones/zone-access-management.service.js';

@Module({
  imports: [
    CamerasModule,
    StorageModule,
    DatabaseModule,
    AuthModule,
    ZonesModule,
    WorkforceModule,
    UsersModule,
  ],
  controllers: [
    SafetyIdentificationController,
    SafetyEpisodesController,
    SafetyEpisodeInboxController,
    TrackedEpisodeFramesController,
    SafetyChecklistController,
    SafetyOverviewController,
    SafetyAlertsController,
    ObservationIdentityController,
    SafetyWorkflowController,
  ],
  providers: [
    Mf06AssessmentWorkerRuntime,
    SafetyIdentificationService,
    SafetyIdentificationRuntime,
    SafetyIdentificationEnabledGuard,
    SafetyEpisodeProjectionService,
    SafetyEpisodeQueryService,
    {
      provide: SafetyEpisodeInboxService,
      inject: [DataSource, UserAuthGuard, ConfigService],
      useFactory: (
        db: DataSource,
        auth: UserAuthGuard,
        config: ConfigService<BackendEnvironment, true>,
      ) =>
        new SafetyEpisodeInboxService(
          db,
          auth,
          () =>
            config.get('AI_TRACKED_FRAME_RUNTIME_ENABLED', { infer: true }) === true ||
            config.get('SAFETY_TRACKED_HISTORY_READ_ENABLED', { infer: true }) === true,
        ),
    },
    {
      provide: TrackedEpisodeFrameQuery,
      inject: [DataSource, UserAuthGuard, ConfigService, WORKER_REFERENCE_READER, StorageService],
      useFactory: (
        db: DataSource,
        auth: UserAuthGuard,
        config: ConfigService<BackendEnvironment, true>,
        workers: WorkerReferenceReader,
        storage: StorageService,
      ) =>
        new TrackedEpisodeFrameQuery(
          db,
          auth,
          config.get('EVIDENCE_LOCAL_ROOT', { infer: true }) ?? '',
          config.get('AI_EVIDENCE_OBJECT_STORAGE_ENABLED', { infer: true }) === true
            ? (root, ref, signal) =>
                readMf06FrameMedia(root, ref, signal, storage.readAiFrame.bind(storage))
            : undefined,
          config.get('AI_EVIDENCE_OBJECT_STORAGE_ENABLED', { infer: true }) === true
            ? (root, ref, subject, signal) =>
                readMf06SubjectMedia(root, ref, subject, signal, storage.readAiFrame.bind(storage))
            : undefined,
          () =>
            config.get('AI_TRACKED_FRAME_RUNTIME_ENABLED', { infer: true }) === true ||
            config.get('SAFETY_TRACKED_HISTORY_READ_ENABLED', { infer: true }) === true,
          workers,
        ),
    },
    Mf06IngestionEnqueueService,
    SafetyChecklistService,
    SafetyOverviewService,
    SafetyWorkflowService,
    SafetyUploadService,
    AlertCandidateEvaluator,
    DurableGroupingService,
    SafetyAlertQueryService,
    SafetyAlertReviewService,
    SafetyAlertEvidenceService,
    SafetyAlertAccessGuard,
    ObservationIdentityAccessGuard,
    { provide: WORKER_REFERENCE_READER, useExisting: WorkforceConfigurationService },
    {
      provide: ObservationIdentityResolutionService,
      inject: [DataSource, SafetyAlertEvidenceService, WORKER_REFERENCE_READER],
      useFactory: (
        dataSource: DataSource,
        evidence: SafetyAlertEvidenceService,
        workers: WorkerReferenceReader,
      ) => new ObservationIdentityResolutionService(dataSource, evidence, workers),
    },
    {
      provide: ObservationIdentityContextService,
      inject: [
        ObservationIdentityResolutionService,
        SafetyAlertEvidenceService,
        ZoneAccessManagementService,
        WORKER_REFERENCE_READER,
      ],
      useFactory: (
        resolutions: ObservationIdentityResolutionService,
        evidence: SafetyAlertEvidenceService,
        zones: ZoneAccessManagementService,
        workers: WorkerReferenceReader,
      ) => new ObservationIdentityContextService(resolutions, evidence, zones, workers),
    },
  ],
  exports: [
    AlertCandidateEvaluator,
    DurableGroupingService,
    Mf06IngestionEnqueueService,
    SafetyEpisodeProjectionService,
  ],
})
export class SafetyModule {}
