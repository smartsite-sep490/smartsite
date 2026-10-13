import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { UsersModule } from '../../users/users.module.js';
import { WorkforceDirectoryModule } from './directory.module.js';
import { ContractorWorkerAccountsController } from './contractor-worker-accounts.controller.js';
import { ContractorWorkerAccountsService } from './contractor-worker-accounts.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, UsersModule, WorkforceDirectoryModule],
  controllers: [ContractorWorkerAccountsController],
  providers: [ContractorWorkerAccountsService],
})
export class WorkerAccountsModule {}
