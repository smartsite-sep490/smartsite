import { SafetyWorkContextService } from './safety-work-context.service.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ManagerOverviewService } from './manager-overview.service.js';
import { ManagerOverviewController } from './manager-overview.controller.js';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ManagerOverviewController],
  providers: [ManagerOverviewService, SafetyWorkContextService],
  exports: [SafetyWorkContextService],
})
export class WorkforceManagementModule {}
