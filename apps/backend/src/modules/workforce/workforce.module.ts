import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ContractorsController } from './contractors.controller.js';
import { ScheduleConfigurationController } from './schedule-configuration.controller.js';
import { ScheduleConfigurationService } from './schedule-configuration.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingWorkflowService } from './scheduling-workflow.service.js';
import { WorkforceConfigurationService } from './workforce-configuration.service.js';
import { WorkforceController } from './workforce.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    WorkforceController,
    ContractorsController,
    ScheduleConfigurationController,
    SchedulingController,
  ],
  providers: [
    WorkforceConfigurationService,
    ScheduleConfigurationService,
    SchedulingWorkflowService,
  ],
  exports: [WorkforceConfigurationService],
})
export class WorkforceModule {}
