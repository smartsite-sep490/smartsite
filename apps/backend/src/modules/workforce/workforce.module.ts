import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../config/environment.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WorkforceConfigurationService } from './workforce-configuration.service.js';
import { WorkforceController } from './workforce.controller.js';
import { ContractorOperationsService } from './contractor-operations.service.js';
import { ContractorOperationsController } from './contractor-operations.controller.js';
import { WorkerAssignmentController } from './worker-assignment.controller.js';
import { FaceEnrollmentController } from './face-enrollment.controller.js';
import { FaceEnrollmentService } from './face-enrollment.service.js';
import { FaceGateController } from './face-gate.controller.js';
import { FaceGateService } from './face-gate.service.js';
import { WorkerGatePermissionsService } from './worker-gate-permissions.service.js';
import { WorkerGatePermissionsController } from './worker-gate-permissions.controller.js';
import { FACE_ENROLLMENT_ADAPTER } from './face-enrollment.service.js';
import {
  HttpFaceEnrollmentAdapter,
  UnavailableFaceEnrollmentAdapter,
} from './face-enrollment.adapter.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [
    WorkforceController,
    ContractorOperationsController,
    WorkerAssignmentController,
    FaceEnrollmentController,
    FaceGateController,
    WorkerGatePermissionsController,
  ],
  providers: [
    WorkforceConfigurationService,
    ContractorOperationsService,
    FaceEnrollmentService,
    FaceGateService,
    WorkerGatePermissionsService,
    {
      provide: FACE_ENROLLMENT_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<BackendEnvironment, true>) => {
        const url = config.get('SMARTSITE_AI_IDENTITY_URL', { infer: true });
        if (!url) return new UnavailableFaceEnrollmentAdapter();
        return new HttpFaceEnrollmentAdapter(
          url,
          config.getOrThrow('SMARTSITE_AI_SERVICE_TOKEN', { infer: true }),
        );
      },
    },
  ],
  exports: [WorkforceConfigurationService, ContractorOperationsService, FaceEnrollmentService],
})
export class WorkforceModule {}
