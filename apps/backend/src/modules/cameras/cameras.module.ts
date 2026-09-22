import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { CameraConfigurationService } from './camera-configuration.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { CamerasController } from './cameras.controller.js';

@Module({
  imports: [DatabaseModule, SitesModule, ZonesModule, AuthModule],
  controllers: [CamerasController],
  providers: [CameraConfigurationService],
  exports: [CameraConfigurationService],
})
export class CamerasModule {}
