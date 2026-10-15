import { useMemo } from 'react';
import type { LoginResponse } from '@smartsite/api-client';
import type { SharedSession } from '../../types/shared-session';

/** Bridges Main's full application session to the existing scoped Zone view. */
export function useZoneApplicationSession(
  provided: SharedSession | null | undefined,
  application: Pick<LoginResponse, 'accessToken' | 'user'> | undefined,
  onSignOut: (() => void) | undefined,
): SharedSession | null | undefined {
  const normalized = useMemo<SharedSession | null | undefined>(() => {
    if (!application) return undefined;
    const { accessToken, user } = application;
    if (!accessToken || !user.isActive || user.mustChangePassword) return null;
    return {
      accessToken,
      sessionScope: `zone-application-${crypto.randomUUID()}`,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        roleAssignments: user.roleAssignments,
        mustChangePassword: user.mustChangePassword,
      },
      onSignOut: onSignOut ?? (() => {}),
    };
  }, [application, onSignOut]);
  // An explicit pending/denied shared session must never fall back to local login.
  return provided !== undefined ? provided : normalized;
}
