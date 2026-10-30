import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WorkforceIdentityModule } from '../identity/identity.module.js';
import { WorkforceAttendanceModule } from '../attendance/attendance.module.js';
import { WorkforceNotificationsModule } from '../notifications/notifications.module.js';
import { QrAccessService } from './qr-access.service.js';
import { VisitorEmailService } from './visitor-email.service.js';
import { SiteAccessSetupService } from './site-access-setup.service.js';
import { SiteAccessSetupController } from './site-access-setup.controller.js';
import { QrAccessController, VisitorRegistrationController } from './qr-access.controller.js';
import { FaceGateController } from './face-gate.controller.js';
import { FaceGateService } from './face-gate.service.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    WorkforceIdentityModule,
    WorkforceAttendanceModule,
    WorkforceNotificationsModule,
  ],
  controllers: [
    QrAccessController,
    VisitorRegistrationController,
    SiteAccessSetupController,
    FaceGateController,
  ],
  providers: [VisitorEmailService, QrAccessService, SiteAccessSetupService, FaceGateService],
})
export class WorkforceAccessModule {}
