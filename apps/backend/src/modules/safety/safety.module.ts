import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { AlertCandidateEvaluator } from './alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from './alerts/durable-grouping.service.js';
import { SafetyAlertQueryService } from './alerts/safety-alert-query.service.js';
import { SafetyAlertsController } from './alerts/safety-alerts.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule, ZonesModule],
  controllers: [SafetyAlertsController],
  providers: [AlertCandidateEvaluator, DurableGroupingService, SafetyAlertQueryService],
  exports: [AlertCandidateEvaluator, DurableGroupingService],
})
export class SafetyModule {}
