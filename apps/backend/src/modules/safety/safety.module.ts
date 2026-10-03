import { Module } from '@nestjs/common';
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
import { WorkforceConfigurationService } from '../workforce/workforce-configuration.service.js';
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
  imports: [DatabaseModule, AuthModule, ZonesModule, WorkforceModule],
  controllers: [SafetyAlertsController, ObservationIdentityController],
  providers: [
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
  exports: [AlertCandidateEvaluator, DurableGroupingService],
})
export class SafetyModule {}
