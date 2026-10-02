import { Injectable } from '@nestjs/common';
import { ZoneRestrictionPolicy } from '../../database/entities/enums.js';
import type { ZoneEntity } from '../../database/entities/zone.entity.js';
import type {
  IZoneAuthorizationService,
  ZoneAuthorizationResult,
  ZoneAuthorizationSubject,
} from './zone-authorization.interface.js';

@Injectable()
export class ZoneAuthorizationService implements IZoneAuthorizationService {
  authorizeZoneEntry(
    zone: Pick<ZoneEntity, 'restrictionPolicy'>,
    subject?: ZoneAuthorizationSubject,
  ): ZoneAuthorizationResult {
    switch (zone.restrictionPolicy) {
      case ZoneRestrictionPolicy.NONE:
        return {
          status: 'ALLOWED',
          reasonCode: 'POLICY_NONE',
        };
      case ZoneRestrictionPolicy.PROHIBITED_FOR_ALL:
        return {
          status: 'DENIED',
          candidateSubtype: 'ZONE_ENTRY_PROHIBITED',
          reasonCode: 'PROHIBITED_FOR_ALL',
          reason: 'Zone entry is prohibited for all individuals',
        };
      case ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED: {
        if (!subject?.candidateWorkerId || !subject.workerId) {
          return {
            status: 'UNAVAILABLE',
            candidateSubtype: 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
            reasonCode: 'IDENTITY_UNAVAILABLE',
            reason: 'A verified worker identity is unavailable for this entry',
          };
        }
        if (!subject.authorizationDataAvailable) {
          return {
            status: 'UNAVAILABLE',
            candidateSubtype: 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
            reasonCode: 'AUTHORIZATION_DATA_UNAVAILABLE',
            reason: 'Zone authorization data is unavailable',
            workerId: subject.workerId,
          };
        }

        const evaluatedMs = subject.evaluatedAt.getTime();
        // Invalid dates compare false in JavaScript, which can accidentally keep
        // an expired/revoked grant active. A partial authority snapshot cannot allow.
        if (
          !Number.isFinite(evaluatedMs) ||
          subject.grants.some((grant) => {
            const fromMs = grant.validFrom.getTime();
            const untilMs = grant.validUntil?.getTime();
            const revokedMs = grant.revokedAt?.getTime();
            return (
              !Number.isFinite(fromMs) ||
              (untilMs !== undefined && (!Number.isFinite(untilMs) || untilMs <= fromMs)) ||
              (revokedMs !== undefined && !Number.isFinite(revokedMs))
            );
          })
        ) {
          return {
            status: 'UNAVAILABLE',
            candidateSubtype: 'ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE',
            reasonCode: 'AUTHORIZATION_DATA_UNAVAILABLE',
            reason: 'Zone authorization time or grant validity is unavailable',
            workerId: subject.workerId,
          };
        }
        const activeGrants = subject.grants.filter((grant) => {
          if (grant.revokedAt !== null && grant.revokedAt.getTime() <= evaluatedMs) return false;
          if (grant.validFrom.getTime() > evaluatedMs) return false;
          return grant.validUntil === null || evaluatedMs < grant.validUntil.getTime();
        });
        if (activeGrants.some((grant) => grant.effect === 'DENY')) {
          return {
            status: 'DENIED',
            candidateSubtype: 'ZONE_ENTRY_UNAUTHORIZED',
            reasonCode: 'EXPLICIT_DENY',
            reason: 'Worker has an active deny grant for this Zone',
            workerId: subject.workerId,
          };
        }
        if (activeGrants.some((grant) => grant.effect === 'ALLOW')) {
          return {
            status: 'ALLOWED',
            reasonCode: 'VALID_ALLOW',
            workerId: subject.workerId,
          };
        }
        return {
          status: 'DENIED',
          candidateSubtype: 'ZONE_ENTRY_UNAUTHORIZED',
          reasonCode: 'NO_VALID_ALLOW',
          reason: 'Worker has no active allow grant for this Zone',
          workerId: subject.workerId,
        };
      }
      default: {
        const exhaustiveCheck: never = zone.restrictionPolicy;
        throw new Error(`Unhandled restriction policy: ${String(exhaustiveCheck)}`);
      }
    }
  }
}
