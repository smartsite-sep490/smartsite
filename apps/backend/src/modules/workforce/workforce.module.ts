import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { SchedulingNotificationService } from './scheduling-notification.service.js';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../config/environment.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ContractorsController } from './contractors.controller.js';
import { ScheduleConfigurationController } from './schedule-configuration.controller.js';
import { ScheduleConfigurationService } from './schedule-configuration.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingWorkflowService } from './scheduling-workflow.service.js';
import { ShiftRequestReaderService } from './shift-request-reader.service.js';
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
    NotificationsController,
    WorkforceController,
    ContractorsController,
    ScheduleConfigurationController,
    SchedulingController,
    ContractorOperationsController,
    WorkerAssignmentController,
    FaceEnrollmentController,
    FaceGateController,
    WorkerGatePermissionsController,
  ],
  providers: [
    SchedulingNotificationService,
    WorkforceConfigurationService,
    ScheduleConfigurationService,
    SchedulingWorkflowService,
    ShiftRequestReaderService,
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
