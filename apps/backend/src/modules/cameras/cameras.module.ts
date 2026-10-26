import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { CameraConfigurationService } from './camera-configuration.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { CamerasController } from './cameras.controller.js';
import { CameraPreviewController } from './camera-preview.controller.js';
import { CameraPreviewService } from './camera-preview.service.js';
import { CameraConfigurationImageController } from './camera-configuration-image.controller.js';
import { CameraConfigurationImageService } from './camera-configuration-image.service.js';
import { CameraConfigurationReferenceController } from './camera-configuration-reference.controller.js';
import { CameraConfigurationReferenceService } from './camera-configuration-reference.service.js';

@Module({
  imports: [DatabaseModule, SitesModule, ZonesModule, AuthModule],
  controllers: [
    CamerasController,
    CameraPreviewController,
    CameraConfigurationImageController,
    CameraConfigurationReferenceController,
  ],
  providers: [
    CameraConfigurationService,
    CameraPreviewService,
    CameraConfigurationImageService,
    CameraConfigurationReferenceService,
  ],
  exports: [CameraConfigurationService],
})
export class CamerasModule {}
