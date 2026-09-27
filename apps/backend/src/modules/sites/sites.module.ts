import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { SiteConfigurationService } from './site-configuration.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { SitesController } from './sites.controller.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [SitesController],
  providers: [SiteConfigurationService],
  exports: [SiteConfigurationService],
})
export class SitesModule {}
