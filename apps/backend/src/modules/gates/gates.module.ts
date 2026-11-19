import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { GatesController, GateReadGuard, PublicGatesController } from './gates.controller.js';
import { GatesService } from './gates.service.js';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [GatesController, PublicGatesController],
  providers: [GatesService, GateReadGuard],
  exports: [GatesService],
})
export class GatesModule {}
