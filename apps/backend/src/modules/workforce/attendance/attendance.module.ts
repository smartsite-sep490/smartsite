import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WorkforceNotificationsModule } from '../notifications/notifications.module.js';
import { AttendanceService } from './attendance.service.js';
import { AttendanceReconciliationService } from './attendance-reconciliation.service.js';
import { AttendanceDaysService } from './attendance-days.service.js';
import { AttendanceDaysController } from './attendance-days.controller.js';
import { AttendanceController } from './attendance.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule, WorkforceNotificationsModule],
  controllers: [AttendanceController, AttendanceDaysController],
  providers: [AttendanceService, AttendanceDaysService, AttendanceReconciliationService],
  exports: [AttendanceReconciliationService],
})
export class WorkforceAttendanceModule {}
