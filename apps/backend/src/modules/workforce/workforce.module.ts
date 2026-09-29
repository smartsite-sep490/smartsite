import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WorkforceConfigurationService } from './workforce-configuration.service.js';
import { WorkforceController } from './workforce.controller.js';
import { ContractorOperationsService } from './contractor-operations.service.js';
import { ContractorOperationsController } from './contractor-operations.controller.js';
import { WorkerAssignmentController } from './worker-assignment.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WorkforceController, ContractorOperationsController, WorkerAssignmentController],
  providers: [WorkforceConfigurationService, ContractorOperationsService],
  exports: [WorkforceConfigurationService, ContractorOperationsService],
})
export class WorkforceModule {}
