import { Module } from '@nestjs/common';
import { WorkforceDirectoryModule } from './directory/directory.module.js';
import { WorkforceTeamsModule } from './teams/teams.module.js';
import { WorkforceNotificationsModule } from './notifications/notifications.module.js';
import { WorkforceAttendanceModule } from './attendance/attendance.module.js';
import { WorkforceSchedulingModule } from './scheduling/scheduling.module.js';
import { WorkforceIdentityModule } from './identity/identity.module.js';
import { WorkforceAccessModule } from './access/access.module.js';

@Module({
  imports: [
    WorkforceDirectoryModule,
    WorkforceTeamsModule,
    WorkforceNotificationsModule,
    WorkforceAttendanceModule,
    WorkforceSchedulingModule,
    WorkforceIdentityModule,
    WorkforceAccessModule,
  ],
  exports: [WorkforceDirectoryModule, WorkforceNotificationsModule, WorkforceIdentityModule],
})
export class WorkforceModule {}
