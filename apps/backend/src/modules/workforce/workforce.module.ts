import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WorkforceConfigurationService } from './workforce-configuration.service.js';
import { WorkforceController } from './workforce.controller.js';
import { ContractorOperationsService } from './contractor-operations.service.js';
import { ContractorOperationsController } from './contractor-operations.controller.js';
import { WorkerAssignmentController } from './worker-assignment.controller.js';
import { FaceEnrollmentController } from './face-enrollment.controller.js';
import { FaceEnrollmentService } from './face-enrollment.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    WorkforceController,
    ContractorOperationsController,
    WorkerAssignmentController,
    FaceEnrollmentController,
  ],
  providers: [WorkforceConfigurationService, ContractorOperationsService, FaceEnrollmentService],
  exports: [WorkforceConfigurationService, ContractorOperationsService, FaceEnrollmentService],
})
export class WorkforceModule {}
