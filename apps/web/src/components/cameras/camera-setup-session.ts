import type { AccountResponse } from '@smartsite/api-client';
import type { WebSession } from '../../features/auth/web-session';
import type { SharedSession, SharedSessionUser } from '../../types/shared-session';

const opaqueInstanceIds = new WeakMap<object, number>();
let nextOpaqueInstanceId = 1;

/**
 * Returns a deterministic, non-reversible numeric identity for an in-memory
 * WebSession manager instance without serializing credentials.
 */
export function getOpaqueInstanceId(instance: object): number {
  const existing = opaqueInstanceIds.get(instance);
  if (existing !== undefined) {
    return existing;
  }
  const assigned = nextOpaqueInstanceId++;
  opaqueInstanceIds.set(instance, assigned);
  return assigned;
}

export interface CameraSetupAuthSnapshot {
  manager?: WebSession;
  epoch?: number;
  accessToken: string | null;
  isSessionExpired: boolean;
  logoutUnconfirmed?: boolean;
  passwordChanged?: boolean;
  mustChangePassword?: boolean;
}

export interface CameraSetupCurrentUserSnapshot {
  data: AccountResponse | undefined;
  isPending: boolean;
  isError: boolean;
}

export type CameraSetupGateState =
  | 'unauthenticated'
  | 'expired'
  | 'pending'
  | 'error'
  | 'password-change-required'
  | 'inactive'
  | 'ready';

export interface DeriveCameraSetupSharedSessionOptions {
  apiUrl: string;
  auth: CameraSetupAuthSnapshot;
  currentUser: CameraSetupCurrentUserSnapshot;
  onSignOut?: () => void;
}

function normalizeApiUrl(apiUrl: string): string {
  return typeof apiUrl === 'string' ? apiUrl.trim().replace(/\/+$/, '') : '';
}

function resolveMainManagerEpoch(auth: CameraSetupAuthSnapshot): number | null {
  if (!auth.manager) {
    return null;
  }
  if (typeof auth.epoch !== 'number' || !Number.isSafeInteger(auth.epoch) || auth.epoch < 0) {
    return null;
  }
  const snapshot =
    typeof auth.manager.getSnapshot === 'function' ? auth.manager.getSnapshot() : null;
  if (!snapshot || snapshot.expired || snapshot.logoutUnconfirmed || snapshot.passwordChanged) {
    return null;
  }
  if (
    typeof snapshot.epoch !== 'number' ||
    !Number.isSafeInteger(snapshot.epoch) ||
    snapshot.epoch < 0 ||
    snapshot.epoch !== auth.epoch
  ) {
    return null;
  }
  if (
    typeof snapshot.token !== 'string' ||
    snapshot.token.trim() === '' ||
    snapshot.token !== auth.accessToken
  ) {
    return null;
  }
  return snapshot.epoch;
}

export function resolveCameraSetupGate({
  apiUrl,
  auth,
  currentUser,
}: DeriveCameraSetupSharedSessionOptions): CameraSetupGateState {
  const normalizedApiUrl = normalizeApiUrl(apiUrl);
  if (!normalizedApiUrl) {
    return 'unauthenticated';
  }

  const snapshot =
    auth.manager && typeof auth.manager.getSnapshot === 'function'
      ? auth.manager.getSnapshot()
      : null;

  if (auth.isSessionExpired || snapshot?.expired) {
    return 'expired';
  }

  const token = typeof auth.accessToken === 'string' ? auth.accessToken.trim() : '';
  if (
    !token ||
    auth.logoutUnconfirmed ||
    snapshot?.logoutUnconfirmed ||
    auth.passwordChanged ||
    snapshot?.passwordChanged
  ) {
    return 'unauthenticated';
  }

  if (resolveMainManagerEpoch(auth) === null) {
    return 'unauthenticated';
  }

  if (auth.mustChangePassword === true || snapshot?.response?.user?.mustChangePassword === true) {
    return 'password-change-required';
  }

  // Strictly check pending and error before inspecting data so cached profiles are never used on error.
  if (currentUser.isPending) {
    return 'pending';
  }
  if (currentUser.isError || !currentUser.data) {
    return 'error';
  }

  const account = currentUser.data;
  if (
    typeof account.id !== 'string' ||
    account.id.trim() === '' ||
    typeof account.displayName !== 'string' ||
    !Array.isArray(account.roleAssignments)
  ) {
    return 'error';
  }

  // When WebSession snapshot has a login/refresh user response, its id must match verified currentUser.id.
  if (snapshot?.response?.user && snapshot.response.user.id !== account.id) {
    return 'unauthenticated';
  }

  if (account.mustChangePassword === true) {
    return 'password-change-required';
  }

  if (account.isActive === false || snapshot?.response?.user?.isActive === false) {
    return 'inactive';
  }

  return 'ready';
}

export function deriveCameraSetupSharedSession(
  options: DeriveCameraSetupSharedSessionOptions,
): SharedSession | null {
  const gate = resolveCameraSetupGate(options);
  if (gate !== 'ready') {
    return null;
  }

  const { apiUrl, auth, currentUser, onSignOut } = options;
  const normalizedApiUrl = normalizeApiUrl(apiUrl);
  const account = currentUser.data!;
  const resolvedManagerEpoch = resolveMainManagerEpoch(auth);

  if (!auth.manager || resolvedManagerEpoch === null) {
    return null;
  }

  const managerId = getOpaqueInstanceId(auth.manager);
  const sessionScope = JSON.stringify([
    'main-web-session',
    normalizedApiUrl,
    managerId,
    resolvedManagerEpoch,
    account.id,
  ]);

  const user: SharedSessionUser = {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    mustChangePassword: false,
    roleAssignments: account.roleAssignments.map((assignment) => ({
      role: assignment.role,
      siteId: assignment.siteId,
    })),
  };

  return {
    accessToken: auth.accessToken!,
    user,
    sessionScope,
    ...(onSignOut ? { onSignOut } : {}),
  };
}
