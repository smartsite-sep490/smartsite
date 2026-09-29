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

@Module({
  imports: [DatabaseModule, AuthModule, ZonesModule],
  controllers: [SafetyAlertsController],
  providers: [
    AlertCandidateEvaluator,
    DurableGroupingService,
    SafetyAlertQueryService,
    SafetyAlertReviewService,
    SafetyAlertAccessGuard,
  ],
  exports: [AlertCandidateEvaluator, DurableGroupingService],
})
export class SafetyModule {}
