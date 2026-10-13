import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ContractorsController } from './contractors.controller.js';
import { WorkforceConfigurationService } from './workforce-configuration.service.js';
import { WorkforceController } from './workforce.controller.js';
import { ContractorOperationsService } from './contractor-operations.service.js';
import { ContractorOperationsController } from './contractor-operations.controller.js';
import { WorkerAssignmentController } from './worker-assignment.controller.js';
import { ContractorParticipationQueryController } from './contractor-participation-query.controller.js';
import { ContractorParticipationQueryService } from './contractor-participation-query.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    WorkforceController,
    ContractorsController,
    ContractorOperationsController,
    WorkerAssignmentController,
    ContractorParticipationQueryController,
  ],
  providers: [
    WorkforceConfigurationService,
    ContractorOperationsService,
    ContractorParticipationQueryService,
  ],
  exports: [WorkforceConfigurationService, ContractorOperationsService],
})
export class WorkforceDirectoryModule {}
