import { Module } from '@nestjs/common';
import { ServiceAuthGuard } from './service-auth.guard.js';

@Module({
  providers: [ServiceAuthGuard],
  exports: [ServiceAuthGuard],
})
export class AuthModule {}
