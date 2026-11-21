import { SiteManagerGuard, SiteSetupReadGuard } from './site-manager.guard.js';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ServiceAuthGuard } from './service-auth.guard.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthService } from './auth.service.js';
import { UserAuthGuard, AdminGuard, ChangePasswordThrottleGuard } from './user-auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthTokenService } from './auth-token.service.js';
import { AccountEmailService } from './account-email.service.js';
import { AccountEmailController } from './account-email.controller.js';

@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AuthController, AccountEmailController],
  providers: [
    AccountEmailService,
    ServiceAuthGuard,
    AuthService,
    AuthTokenService,
    UserAuthGuard,
    AdminGuard,
    SiteManagerGuard,
    SiteSetupReadGuard,
    ChangePasswordThrottleGuard,
  ],
  exports: [
    AccountEmailService,
    ServiceAuthGuard,
    AuthService,
    UserAuthGuard,
    AdminGuard,
    SiteManagerGuard,
    SiteSetupReadGuard,
  ],
})
export class AuthModule {}
