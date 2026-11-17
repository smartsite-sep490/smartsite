import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, useCurrentUser, useLogout } from '../../features/auth/auth-session';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import './camera-setup-workspace-copy';
import { CameraSetupView } from './CameraSetupView';
import { deriveCameraSetupSharedSession, resolveCameraSetupGate } from './camera-setup-session';

const DEFAULT_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface CameraSetupRouteProps {
  apiUrl?: string;
}

export function CameraSetupRoute({ apiUrl = DEFAULT_API_URL }: CameraSetupRouteProps = {}) {
  const { t } = useTranslation();
  const { t: safetyT } = useTranslation(SAFETY_NAMESPACE);
  const auth = useAuth();
  const currentUser = useCurrentUser(apiUrl);
  const logout = useLogout(apiUrl);
  const signedOutScopeRef = useRef<string | null>(null);

  const gate = resolveCameraSetupGate({
    apiUrl,
    auth,
    currentUser,
  });

  const handleSignOut = useCallback(
    (scope: string) => {
      if (logout.isPending || signedOutScopeRef.current === scope) {
        return;
      }
      signedOutScopeRef.current = scope;
      logout.mutate();
    },
    [logout],
  );

  const sharedSession = useMemo(() => {
    if (gate !== 'ready') {
      return null;
    }
    const baseSession = deriveCameraSetupSharedSession({
      apiUrl,
      auth,
      currentUser,
    });
    if (!baseSession) {
      return null;
    }
    return baseSession;
  }, [gate, apiUrl, auth, currentUser]);

  if (gate === 'unauthenticated' || gate === 'expired') {
    return <p role="status">{safetyT('cameraSetup.session')}</p>;
  }

  if (gate === 'pending') {
    return <p role="status">{t('auth.loadingAccount')}</p>;
  }

  if (gate === 'error') {
    return (
      <div role="alert">
        <p>{t('auth.loadAccountError')}</p>
        <button
          type="button"
          disabled={currentUser.isFetching}
          onClick={() => void currentUser.refetch()}
        >
          {t('accounts.retry')}
        </button>
      </div>
    );
  }

  if (gate === 'password-change-required' || gate === 'inactive') {
    return <p role="alert">{safetyT('cameraSetup.denied')}</p>;
  }

  if (!sharedSession) {
    return <p role="status">{safetyT('cameraSetup.session')}</p>;
  }

  return (
    <CameraSetupView
      apiUrl={apiUrl}
      sharedSession={{
        ...sharedSession,
        onSignOut: () => handleSignOut(sharedSession.sessionScope),
      }}
    />
  );
}
