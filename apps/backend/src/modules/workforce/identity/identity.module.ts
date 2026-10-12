import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WorkforceDirectoryModule } from '../directory/directory.module.js';
import { FaceEnrollmentController, FaceConsentController } from './face-enrollment.controller.js';
import { FaceEnrollmentService } from './face-enrollment.service.js';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../../config/environment.js';
import { FACE_ENROLLMENT_ADAPTER } from './face-enrollment.service.js';
import {
  HttpFaceEnrollmentAdapter,
  UnavailableFaceEnrollmentAdapter,
} from './face-enrollment.adapter.js';

@Module({
  imports: [DatabaseModule, AuthModule, WorkforceDirectoryModule],
  controllers: [FaceEnrollmentController, FaceConsentController],
  providers: [
    FaceEnrollmentService,
    {
      provide: FACE_ENROLLMENT_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<BackendEnvironment, true>) => {
        const url = config.get('SMARTSITE_AI_IDENTITY_URL', { infer: true });
        if (!url) return new UnavailableFaceEnrollmentAdapter();
        return new HttpFaceEnrollmentAdapter(
          url,
          config.getOrThrow('SMARTSITE_AI_SERVICE_TOKEN', { infer: true }),
        );
      },
    },
  ],
  exports: [FaceEnrollmentService, FACE_ENROLLMENT_ADAPTER],
})
export class WorkforceIdentityModule {}
