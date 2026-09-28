import type { ZoneEntity } from '../../database/entities/zone.entity.js';

export type ZoneAuthorizationStatus = 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';

export type ZoneAccessEffect = 'ALLOW' | 'DENY';

export interface EffectiveZoneAccessGrant {
  effect: ZoneAccessEffect;
  validFrom: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
}

export interface ZoneAuthorizationSubject {
  candidateWorkerId?: string;
  workerId?: string;
  evaluatedAt: Date;
  authorizationDataAvailable: boolean;
  grants: readonly EffectiveZoneAccessGrant[];
}

export interface ZoneAuthorizationResult {
  status: ZoneAuthorizationStatus;
  candidateSubtype?:
    'ZONE_ENTRY_PROHIBITED' | 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE' | 'ZONE_ENTRY_UNAUTHORIZED';
  reasonCode?:
    | 'POLICY_NONE'
    | 'PROHIBITED_FOR_ALL'
    | 'IDENTITY_UNAVAILABLE'
    | 'AUTHORIZATION_DATA_UNAVAILABLE'
    | 'EXPLICIT_DENY'
    | 'VALID_ALLOW'
    | 'NO_VALID_ALLOW';
  reason?: string;
  workerId?: string;
}

export interface IZoneAuthorizationService {
  authorizeZoneEntry(
    zone: Pick<ZoneEntity, 'restrictionPolicy'>,
    subject?: ZoneAuthorizationSubject,
  ): ZoneAuthorizationResult;
}
