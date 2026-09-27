import { Module } from '@nestjs/common';
import { ObservationContextResolverService } from './observation-context-resolver.service.js';
import { ZoneAuthorizationService } from './zone-authorization.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { ZoneConfigurationService } from './zone-configuration.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ZonesController } from './zones.controller.js';

@Module({
  imports: [DatabaseModule, SitesModule, AuthModule],
  controllers: [ZonesController],
  providers: [
    ObservationContextResolverService,
    ZoneAuthorizationService,
    ZoneConfigurationService,
  ],
  exports: [ObservationContextResolverService, ZoneAuthorizationService, ZoneConfigurationService],
})
export class ZonesModule {}
