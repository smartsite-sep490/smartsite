import { SafetyChecklistService } from './safety-checklist.service.js';
import { SafetyChecklistController } from './safety-checklist.controller.js';
import { SafetyOverviewService } from './safety-overview.service.js';
import { SafetyOverviewController } from './safety-overview.controller.js';
import { CamerasModule } from '../cameras/cameras.module.js';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { UsersModule } from '../users/users.module.js';
import { SafetyWorkflowService } from './safety-workflow.service.js';
import { SafetyWorkflowController } from './safety-workflow.controller.js';
import { SafetyUploadService } from './safety-upload.service.js';
import { Mf06IngestionEnqueueService } from './assessments/mf06-ingestion-enqueue.service.js';
import { Module } from '@nestjs/common';
import { SafetyEpisodeInboxController } from './alerts/safety-episode-inbox.controller.js';
import { SafetyEpisodeInboxService } from './alerts/safety-episode-inbox.service.js';
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
    SafetyEpisodeInboxController,
    SafetyChecklistController,
    SafetyOverviewController,
    SafetyAlertsController,
    ObservationIdentityController,
    SafetyWorkflowController,
  ],
  providers: [
    SafetyEpisodeInboxService,
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
  exports: [AlertCandidateEvaluator, DurableGroupingService, Mf06IngestionEnqueueService],
})
export class SafetyModule {}
