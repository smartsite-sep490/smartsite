import { Injectable } from '@nestjs/common';
import { ZoneRestrictionPolicy } from '../../database/entities/enums.js';
import type { ZoneEntity } from '../../database/entities/zone.entity.js';
import type {
  IZoneAuthorizationService,
  ZoneAuthorizationResult,
} from './zone-authorization.interface.js';

@Injectable()
export class ZoneAuthorizationService implements IZoneAuthorizationService {
  authorizeZoneEntry(zone: Pick<ZoneEntity, 'restrictionPolicy'>): ZoneAuthorizationResult {
    switch (zone.restrictionPolicy) {
      case ZoneRestrictionPolicy.NONE:
        return {
          status: 'ALLOWED',
        };
      case ZoneRestrictionPolicy.PROHIBITED_FOR_ALL:
        return {
          status: 'DENIED',
          candidateSubtype: 'ZONE_ENTRY_PROHIBITED',
          reason: 'Zone entry is prohibited for all individuals',
        };
      case ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED:
        return {
          status: 'UNAVAILABLE',
          candidateSubtype: 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
          reason: 'Workforce authorization dependency is unavailable in foundation',
        };
      default: {
        const exhaustiveCheck: never = zone.restrictionPolicy;
        throw new Error(`Unhandled restriction policy: ${String(exhaustiveCheck)}`);
      }
    }
  }
}
