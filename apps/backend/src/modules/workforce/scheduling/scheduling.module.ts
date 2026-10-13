import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WorkforceNotificationsModule } from '../notifications/notifications.module.js';
import { WorkforceAttendanceModule } from '../attendance/attendance.module.js';
import { ScheduleAssignmentController } from './schedule-assignment.controller.js';
import { ScheduleAssignmentService } from './schedule-assignment.service.js';
import { ScheduleConfigurationController } from './schedule-configuration.controller.js';
import { ScheduleConfigurationService } from './schedule-configuration.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingWorkflowService } from './scheduling-workflow.service.js';
import { ShiftRequestReaderService } from './shift-request-reader.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, WorkforceNotificationsModule, WorkforceAttendanceModule],
  controllers: [
    ScheduleConfigurationController,
    ScheduleAssignmentController,
    SchedulingController,
  ],
  providers: [
    ScheduleConfigurationService,
    ScheduleAssignmentService,
    SchedulingWorkflowService,
    ShiftRequestReaderService,
  ],
})
export class WorkforceSchedulingModule {}
