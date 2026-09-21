import { Module } from '@nestjs/common';
import { ObservationContextResolverService } from './observation-context-resolver.service.js';
import { ZoneAuthorizationService } from './zone-authorization.service.js';

@Module({
  providers: [ObservationContextResolverService, ZoneAuthorizationService],
  exports: [ObservationContextResolverService, ZoneAuthorizationService],
})
export class ZonesModule {}
