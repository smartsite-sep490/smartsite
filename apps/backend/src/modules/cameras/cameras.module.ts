import { Module } from '@nestjs/common';
import { CameraEventAdmissionService } from './camera-event-admission.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { ZonesModule } from '../zones/zones.module.js';
import { CameraConfigurationService } from './camera-configuration.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { CamerasController } from './cameras.controller.js';
import { CameraConfigurationImageController } from './camera-configuration-image.controller.js';
import {
  CAMERA_CONFIGURATION_IMAGE_FETCH,
  CameraConfigurationImageService,
} from './camera-configuration-image.service.js';
import { CameraConfigurationReferenceController } from './camera-configuration-reference.controller.js';
import { CameraConfigurationReferenceService } from './camera-configuration-reference.service.js';
import { CameraApplicationStatusController } from './camera-application-status.controller.js';
import { CameraApplicationStatusService } from './camera-application-status.service.js';

@Module({
  imports: [DatabaseModule, SitesModule, ZonesModule, AuthModule],
  controllers: [
    CameraApplicationStatusController,
    CamerasController,
    CameraConfigurationImageController,
    CameraConfigurationReferenceController,
  ],
  providers: [
    CameraEventAdmissionService,
    CameraApplicationStatusService,
    { provide: CAMERA_CONFIGURATION_IMAGE_FETCH, useFactory: () => globalThis.fetch },
    CameraConfigurationService,
    CameraConfigurationImageService,
    CameraConfigurationReferenceService,
  ],
  exports: [CameraConfigurationService, CameraEventAdmissionService],
})
export class CamerasModule {}
