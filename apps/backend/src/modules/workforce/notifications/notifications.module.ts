import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { NotificationsController } from './notifications.controller.js';
import { SchedulingNotificationService } from './scheduling-notification.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [NotificationsController],
  providers: [SchedulingNotificationService],
  exports: [SchedulingNotificationService],
})
export class WorkforceNotificationsModule {}
