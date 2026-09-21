import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../../modules/auth/auth.module.js';
import { SafetyModule } from '../../modules/safety/safety.module.js';
import { ZonesModule } from '../../modules/zones/zones.module.js';
import { AiIngestionController } from './ai-ingestion.controller.js';
import { AiIngestionService } from './ai-ingestion.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, ZonesModule, SafetyModule],
  controllers: [AiIngestionController],
  providers: [AiIngestionService],
})
export class AiIntegrationModule {}
