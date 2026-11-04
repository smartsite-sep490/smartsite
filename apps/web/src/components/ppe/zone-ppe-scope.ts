import type { QueryClient } from '@tanstack/react-query';

const tokenNonces = new WeakMap<QueryClient, { token: string; nonce: number }>();
let nextTokenNonce = 1;

export function getOpaqueTokenNonce(client: QueryClient, token: string): number {
  if (!token) {
    tokenNonces.delete(client);
    return 0;
  }
  const previous = tokenNonces.get(client);
  if (previous?.token === token) return previous.nonce;
  const nonce = nextTokenNonce++;
  tokenNonces.set(client, { token, nonce });
  return nonce;
}

export interface ZonePpeCapabilities {
  canManageZones: boolean;
  canManageRegions: boolean;
}

export function deriveZonePpeCapabilities(
  user:
    | {
        roleAssignments?: ReadonlyArray<{ role: string; siteId: string | null }> | null;
        mustChangePassword?: boolean;
      }
    | null
    | undefined,
  siteId: string | null | undefined,
): ZonePpeCapabilities {
  if (
    !user ||
    user.mustChangePassword === true ||
    !siteId ||
    !Array.isArray(user.roleAssignments)
  ) {
    return { canManageZones: false, canManageRegions: false };
  }
  const canManageZones = user.roleAssignments.some(
    (r) => r.role === 'SITE_MANAGER' && r.siteId === siteId,
  );
  const canManageRegions = canManageZones;
  return { canManageZones, canManageRegions };
}

/** Credential identity is opaque; raw tokens never become React or query keys. */
export function getZonePpeScopeKey(
  client: QueryClient,
  props: {
    apiUrl: string;
    sessionScope: string;
    credentialId: number;
    siteId: string;
    token: string;
    canManageZones?: boolean;
    canManageRegions?: boolean;
    canReadZones?: boolean;
    section?: 'all' | 'zones' | 'regions';
    initialCameraId?: string;
  },
): string {
  return JSON.stringify([
    props.apiUrl,
    props.sessionScope,
    props.credentialId,
    props.siteId,
    getOpaqueTokenNonce(client, props.token),
    Boolean(props.canManageZones),
    Boolean(props.canManageRegions),
    Boolean(props.canReadZones),
    props.section ?? 'all',
    props.initialCameraId ?? '',
  ]);
}
