import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { MainZonePermissionCommandService } from '../zones/main-zone-permission-command.service.js';
import { WorkforceDirectoryModule } from './directory/directory.module.js';
import { WorkerAccountsModule } from './directory/worker-accounts.module.js';
import { WorkforceTeamsModule } from './teams/teams.module.js';
import { WorkforceNotificationsModule } from './notifications/notifications.module.js';
import { WorkforceAttendanceModule } from './attendance/attendance.module.js';
import { WorkforceSchedulingModule } from './scheduling/scheduling.module.js';
import { WorkforceIdentityModule } from './identity/identity.module.js';
import { WorkforceAccessModule } from './access/access.module.js';
import { WorkforceManagementModule } from './management/management.module.js';
import { SiteAccessSetupQueryService } from './site-access-setup-query.service.js';

@Module({
  imports: [
    DatabaseModule,
    WorkforceDirectoryModule,
    WorkerAccountsModule,
    WorkforceTeamsModule,
    WorkforceNotificationsModule,
    WorkforceAttendanceModule,
    WorkforceSchedulingModule,
    WorkforceIdentityModule,
    WorkforceAccessModule,
    WorkforceManagementModule,
  ],
  providers: [MainZonePermissionCommandService, SiteAccessSetupQueryService],
  exports: [
    WorkforceDirectoryModule,
    WorkforceNotificationsModule,
    WorkforceIdentityModule,
    MainZonePermissionCommandService,
    SiteAccessSetupQueryService,
    WorkforceManagementModule,
  ],
})
export class WorkforceModule {}
