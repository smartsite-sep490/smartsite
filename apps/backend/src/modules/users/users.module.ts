import { WorkforceDirectoryModule } from '../workforce/directory/directory.module.js';
import {
  SiteRepresentativesController,
  SiteRepresentativesService,
} from './site-representatives.controller.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [DatabaseModule, AuthModule, SitesModule, WorkforceDirectoryModule],
  controllers: [UsersController, SiteRepresentativesController],
  providers: [UsersService, SiteRepresentativesService],
  exports: [UsersService],
})
export class UsersModule {}
