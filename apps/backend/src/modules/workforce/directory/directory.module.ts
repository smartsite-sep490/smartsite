import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { MainAssignmentCommandService } from '../../zones/main-assignment-command.service.js';
import { MainParticipationCommandService } from '../../zones/main-participation-command.service.js';
import { MainRepresentativeCommandService } from '../main-representative-command.service.js';
import { MainWorkerRosterService } from '../main-worker-roster.service.js';
import { MainWorkforceCreateService } from '../main-workforce-create.service.js';
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
    MainAssignmentCommandService,
    MainParticipationCommandService,
    MainWorkforceCreateService,
    MainWorkerRosterService,
    MainRepresentativeCommandService,
  ],
  exports: [
    WorkforceConfigurationService,
    ContractorOperationsService,
    MainAssignmentCommandService,
    MainParticipationCommandService,
    MainWorkforceCreateService,
    MainWorkerRosterService,
    MainRepresentativeCommandService,
  ],
})
export class WorkforceDirectoryModule {}
