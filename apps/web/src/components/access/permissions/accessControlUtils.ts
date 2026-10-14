import { translate as tr } from '../../../i18n';
import type { ZoneEntryDecisionStatus } from '@smartsite/api-client';

type GrantWindow = {
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
};

export type GrantState = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'REVOKED';

export function grantState(grant: GrantWindow, now = new Date()): GrantState {
  if (grant.revokedAt) return 'REVOKED';
  if (Date.parse(grant.validFrom) > now.getTime()) return 'SCHEDULED';
  if (grant.validUntil && Date.parse(grant.validUntil) <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export function zoneDecisionLabel(status: ZoneEntryDecisionStatus): string {
  if (status === 'ALLOWED') return tr('common.allowed_1bb201');
  if (status === 'DENIED') return tr('common.denied_da404d');
  return tr('common.authorization_unavailable');
}

export function toUtcIso(value: string): string | null {
  if (!value) return null;
  return new Date(value).toISOString();
}
