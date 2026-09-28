import { Module } from '@nestjs/common';
import { ObservationContextResolverService } from './observation-context-resolver.service.js';
import { ZoneAuthorizationService } from './zone-authorization.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { SitesModule } from '../sites/sites.module.js';
import { ZoneConfigurationService } from './zone-configuration.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ZonesController } from './zones.controller.js';
import { ZoneEntryAuthorizationService } from './zone-entry-authorization.service.js';
import { ZoneAccessManagementService } from './zone-access-management.service.js';
import { ZoneAccessController, ZoneEntryDecisionsController } from './zone-access.controller.js';

@Module({
  imports: [DatabaseModule, SitesModule, AuthModule],
  controllers: [ZonesController, ZoneAccessController, ZoneEntryDecisionsController],
  providers: [
    ObservationContextResolverService,
    ZoneAuthorizationService,
    ZoneConfigurationService,
    ZoneEntryAuthorizationService,
    ZoneAccessManagementService,
  ],
  exports: [
    ObservationContextResolverService,
    ZoneAuthorizationService,
    ZoneConfigurationService,
    ZoneEntryAuthorizationService,
    ZoneAccessManagementService,
  ],
})
export class ZonesModule {}
