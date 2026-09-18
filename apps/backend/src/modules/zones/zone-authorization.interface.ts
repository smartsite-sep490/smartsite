import type { ZoneEntity } from '../../database/entities/zone.entity.js';

export type ZoneAuthorizationStatus = 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';

export interface ZoneAuthorizationResult {
  status: ZoneAuthorizationStatus;
  candidateSubtype?: 'ZONE_ENTRY_PROHIBITED' | 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE';
  reason?: string;
}

export interface IZoneAuthorizationService {
  authorizeZoneEntry(zone: Pick<ZoneEntity, 'restrictionPolicy'>): ZoneAuthorizationResult;
}
