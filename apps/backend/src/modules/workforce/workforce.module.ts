import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { WorkerDocumentsModule } from './documents/worker-documents.module.js';
import { WorkforceDirectoryModule } from './directory/directory.module.js';
import { WorkerAccountsModule } from './directory/worker-accounts.module.js';
import { WorkforceTeamsModule } from './teams/teams.module.js';
import { WorkforceNotificationsModule } from './notifications/notifications.module.js';
import { WorkforceAttendanceModule } from './attendance/attendance.module.js';
import { WorkforceSchedulingModule } from './scheduling/scheduling.module.js';
import { WorkforceIdentityModule } from './identity/identity.module.js';
import { WorkforceAccessModule } from './access/access.module.js';
import { WorkforceManagementModule } from './management/management.module.js';

@Module({
  imports: [
    DatabaseModule,
    WorkerDocumentsModule,
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
  exports: [
    WorkforceDirectoryModule,
    WorkforceNotificationsModule,
    WorkforceIdentityModule,
    WorkforceAccessModule,
    WorkforceManagementModule,
  ],
})
export class WorkforceModule {}
