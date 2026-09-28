import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { WorkforceConfigurationService } from './workforce-configuration.service.js';
import { WorkforceController } from './workforce.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WorkforceController],
  providers: [WorkforceConfigurationService],
  exports: [WorkforceConfigurationService],
})
export class WorkforceModule {}
