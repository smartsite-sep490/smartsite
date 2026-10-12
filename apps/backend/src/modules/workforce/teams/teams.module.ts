import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { ContractorTeamsController } from './contractor-teams.controller.js';
import { ContractorTeamsService } from './contractor-teams.service.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ContractorTeamsController],
  providers: [ContractorTeamsService],
})
export class WorkforceTeamsModule {}
