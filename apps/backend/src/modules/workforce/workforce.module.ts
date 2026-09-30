import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ContractorsController } from './contractors.controller.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingWorkflowService } from './scheduling-workflow.service.js';
import { WorkforceConfigurationService } from './workforce-configuration.service.js';
import { WorkforceController } from './workforce.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WorkforceController, ContractorsController, SchedulingController],
  providers: [WorkforceConfigurationService, SchedulingWorkflowService],
  exports: [WorkforceConfigurationService],
})
export class WorkforceModule {}
