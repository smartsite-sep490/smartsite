import { Module } from '@nestjs/common';
import { ZonesModule } from '../zones/zones.module.js';
import { AlertCandidateEvaluator } from './alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from './alerts/durable-grouping.service.js';

@Module({
  imports: [ZonesModule],
  providers: [AlertCandidateEvaluator, DurableGroupingService],
  exports: [AlertCandidateEvaluator, DurableGroupingService],
})
export class SafetyModule {}
