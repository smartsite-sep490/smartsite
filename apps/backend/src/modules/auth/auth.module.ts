import { Module } from '@nestjs/common';
import { ServiceAuthGuard } from './service-auth.guard.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthService } from './auth.service.js';
import { UserAuthGuard, AdminGuard, ChangePasswordThrottleGuard } from './user-auth.guard.js';
import { AuthController } from './auth.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    ServiceAuthGuard,
    AuthService,
    UserAuthGuard,
    AdminGuard,
    ChangePasswordThrottleGuard,
  ],
  exports: [ServiceAuthGuard, AuthService, UserAuthGuard, AdminGuard],
})
export class AuthModule {}
