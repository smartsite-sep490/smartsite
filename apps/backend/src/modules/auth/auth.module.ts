import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ServiceAuthGuard } from './service-auth.guard.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthService } from './auth.service.js';
import { UserAuthGuard, AdminGuard, ChangePasswordThrottleGuard } from './user-auth.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthTokenService } from './auth-token.service.js';

@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    ServiceAuthGuard,
    AuthService,
    AuthTokenService,
    UserAuthGuard,
    AdminGuard,
    ChangePasswordThrottleGuard,
  ],
  exports: [ServiceAuthGuard, AuthService, UserAuthGuard, AdminGuard],
})
export class AuthModule {}
