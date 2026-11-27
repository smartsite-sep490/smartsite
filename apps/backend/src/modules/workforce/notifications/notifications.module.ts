import { NotificationInboxService } from './notification-inbox.service.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { NotificationsController } from './notifications.controller.js';
import { SchedulingNotificationService } from './scheduling-notification.service.js';
import { MobilePushService } from './mobile-push.service.js';
import { MobilePushController } from './mobile-push.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [NotificationsController, MobilePushController],
  providers: [SchedulingNotificationService, NotificationInboxService, MobilePushService],
  exports: [SchedulingNotificationService],
})
export class WorkforceNotificationsModule {}
