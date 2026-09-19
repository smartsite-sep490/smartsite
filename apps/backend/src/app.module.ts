import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthController } from './health/health.controller.js';
import { AiIngestionController } from './integrations/ai/ai-ingestion.controller.js';
import { AiIngestionService } from './integrations/ai/ai-ingestion.service.js';
import { ObservationContextResolverService } from './modules/zones/observation-context-resolver.service.js';
import { ZoneAuthorizationService } from './modules/zones/zone-authorization.service.js';
import { AlertCandidateEvaluator } from './modules/safety/alerts/alert-candidate-evaluator.js';
import { DurableGroupingService } from './modules/safety/alerts/durable-grouping.service.js';
import { ServiceAuthGuard } from './modules/auth/service-auth.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    DatabaseModule,
  ],
  controllers: [HealthController, AiIngestionController],
  providers: [
    AiIngestionService,
    ObservationContextResolverService,
    ZoneAuthorizationService,
    AlertCandidateEvaluator,
    DurableGroupingService,
    ServiceAuthGuard,
  ],
})
export class AppModule {}
