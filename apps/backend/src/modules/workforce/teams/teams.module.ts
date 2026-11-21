import { Module } from '@nestjs/common';
import { TeamAttendanceController } from './team-attendance.controller.js';
import { TeamAttendanceService } from './team-attendance.service.js';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ContractorTeamsController } from './contractor-teams.controller.js';
import { ContractorTeamsService } from './contractor-teams.service.js';
import { WorkforceAttendanceModule } from '../attendance/attendance.module.js';

@Module({
  imports: [DatabaseModule, AuthModule, WorkforceAttendanceModule],
  controllers: [ContractorTeamsController, TeamAttendanceController],
  providers: [ContractorTeamsService, TeamAttendanceService],
})
export class WorkforceTeamsModule {}
