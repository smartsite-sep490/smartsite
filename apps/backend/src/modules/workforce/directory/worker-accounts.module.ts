import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { UsersModule } from '../../users/users.module.js';
import { WorkforceDirectoryModule } from './directory.module.js';
import { ContractorWorkerAccountsController } from './contractor-worker-accounts.controller.js';
import { ContractorWorkerAccountsService } from './contractor-worker-accounts.service.js';
import { StorageModule } from '../../../integrations/storage/storage.module.js';
import { WorkerOnboardingController } from './worker-onboarding.controller.js';
import { WorkerOnboardingService } from './worker-onboarding.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, UsersModule, WorkforceDirectoryModule, StorageModule],
  controllers: [ContractorWorkerAccountsController, WorkerOnboardingController],
  providers: [ContractorWorkerAccountsService, WorkerOnboardingService],
})
export class WorkerAccountsModule {}
