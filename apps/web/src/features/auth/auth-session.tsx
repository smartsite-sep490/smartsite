import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import {
  SmartSiteManagementClient,
  type AccountResponse,
  ApiError,
  registerSessionCredential,
  unregisterSessionCredential,
} from '@smartsite/api-client';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useId,
} from 'react';

// Create a context for the auth state so we don't have to prop-drill the token
type AuthState = {
  accessToken: string | null;
  sessionScope: string;
  mustChangePassword?: boolean;
  setAccessToken: (token: string | null) => void;
  isSessionExpired: boolean;
  triggerSessionExpired: (expiredScope?: string) => void;
  dismissSessionExpired: () => void;
};

export const AuthContext = createContext<AuthState>({
  accessToken: null,
  sessionScope: '',
  setAccessToken: () => {},
  isSessionExpired: false,
  triggerSessionExpired: () => {},
  dismissSessionExpired: () => {},
});

// Keep request ordering private to the auth feature, separate from the public
// AuthContext used by feature tests and shared-session adapters.
const AuthLifecycleContext = createContext<{
  canRestoreSession: boolean;
  beginChange: () => number;
  beginLogin: () => number;
  revision: () => number;
  isCurrent: (revision: number) => boolean;
}>({
  canRestoreSession: true,
  beginChange: () => 0,
  beginLogin: () => 0,
  revision: () => 0,
  isCurrent: (revision: number) => revision === 0,
});

const logoutIntentKey = (apiUrl: string) => `smartsite:logout:${apiUrl.replace(/\/+$/, '')}`;
function hasLogoutIntent(apiUrl: string): boolean {
  try {
    return sessionStorage.getItem(logoutIntentKey(apiUrl)) === '1';
  } catch {
    return false;
  }
}
function rememberLogoutIntent(apiUrl: string, requested: boolean) {
  try {
    if (requested) sessionStorage.setItem(logoutIntentKey(apiUrl), '1');
    else sessionStorage.removeItem(logoutIntentKey(apiUrl));
  } catch {
    // Storage can be unavailable; in-memory request ordering still applies.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [sessionScope, setSessionScope] = useState<string>('');
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const sessionScopeRef = useRef<string>('');
  const tokenRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const [canRestoreSession, setCanRestoreSession] = useState(true);
  const revision = useCallback(() => revisionRef.current, []);
  const isCurrent = useCallback(
    (capturedRevision: number) => capturedRevision === revisionRef.current,
    [],
  );
  const beginChange = useCallback(() => {
    setCanRestoreSession(false);
    return ++revisionRef.current;
  }, []);
  const clearPrivateQueries = useCallback(() => {
    const filter = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        !(query.queryKey[0] === 'auth' && query.queryKey[1] === 'session'),
    };
    void queryClient.cancelQueries(filter);
    queryClient.removeQueries(filter);
  }, [queryClient]);

  const setAccessToken = useCallback(
    (token: string | null) => {
      beginChange();
      clearPrivateQueries();
      if (tokenRef.current) unregisterSessionCredential(tokenRef.current, sessionScopeRef.current);
      tokenRef.current = token;
      setAccessTokenState(token);
      const newScope = token ? crypto.randomUUID() : '';
      setSessionScope(newScope);
      sessionScopeRef.current = newScope;
      if (token) registerSessionCredential(token, newScope);
    },
    [beginChange, clearPrivateQueries],
  );

  const beginLogin = useCallback(() => {
    const nextRevision = beginChange();
    clearPrivateQueries();
    if (tokenRef.current) unregisterSessionCredential(tokenRef.current, sessionScopeRef.current);
    tokenRef.current = null;
    sessionScopeRef.current = '';
    setAccessTokenState(null);
    setSessionScope('');
    return nextRevision;
  }, [beginChange, clearPrivateQueries]);

  const triggerSessionExpired = useCallback(
    (expiredScope?: string) => {
      // Guard late previous-session 401: if an expiredScope was provided and it doesn't match the current active scope, ignore it!
      if (expiredScope !== undefined && expiredScope !== sessionScopeRef.current) {
        return;
      }
      if (tokenRef.current === null) return;
      beginChange();
      clearPrivateQueries();
      queryClient.removeQueries({ queryKey: ['auth', 'session'] });
      queryClient.getMutationCache().clear();
      if (tokenRef.current !== null) setIsSessionExpired(true);
      if (tokenRef.current) unregisterSessionCredential(tokenRef.current, sessionScopeRef.current);
      tokenRef.current = null;
      setAccessTokenState(null);
      setSessionScope('');
      sessionScopeRef.current = '';
    },
    [beginChange, clearPrivateQueries, queryClient],
  );

  const dismissSessionExpired = useCallback(() => {
    setIsSessionExpired(false);
  }, []);

  useLayoutEffect(() => {
    const handleExpiredEvent = (event: Event) => {
      if (!sessionScopeRef.current) return;
      if (event instanceof CustomEvent && event.detail != null) {
        const detail: unknown = event.detail;
        if (detail === null || typeof detail !== 'object' || !('sessionScopes' in detail)) return;
        const scopes = detail.sessionScopes;
        if (!Array.isArray(scopes) || !scopes.includes(sessionScopeRef.current)) return;
      }
      triggerSessionExpired();
    };
    // Restore the binding after React's development StrictMode effect replay.
    if (tokenRef.current) registerSessionCredential(tokenRef.current, sessionScopeRef.current);
    window.addEventListener('smartsite:session-expired', handleExpiredEvent);
    return () => {
      window.removeEventListener('smartsite:session-expired', handleExpiredEvent);
      if (tokenRef.current) unregisterSessionCredential(tokenRef.current, sessionScopeRef.current);
    };
  }, [triggerSessionExpired]);

  return (
    <AuthLifecycleContext.Provider
      value={{ canRestoreSession, beginChange, beginLogin, revision, isCurrent }}
    >
      <AuthContext.Provider
        value={{
          accessToken,
          sessionScope,
          setAccessToken,
          isSessionExpired,
          triggerSessionExpired,
          dismissSessionExpired,
        }}
      >
        {children}
      </AuthContext.Provider>
    </AuthLifecycleContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}

// ── Session Expired Luxury Modal ──────────────────────────────────────────────
export function SessionExpiredModal({ open, onReLogin }: { open: boolean; onReLogin: () => void }) {
  useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const actionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    actionRef.current?.focus();
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      actionRef.current?.focus();
    };
    document.addEventListener('keydown', keepFocus);
    return () => {
      document.removeEventListener('keydown', keepFocus);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#041D2E]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md bg-white rounded-3xl border border-[#DCE6EF] shadow-[0_24px_64px_rgba(7,26,43,0.3)] p-6 sm:p-8 text-center space-y-5 relative overflow-hidden"
      >
        {/* Top Decorative Amber Accent */}
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-24 bg-[#F66B17]/15 rounded-full blur-2xl pointer-events-none" />

        {/* Warning Badge Icon */}
        <div className="w-16 h-16 rounded-2xl bg-[#FFF7ED] border border-[#FFEDD5] text-[#F66B17] mx-auto flex items-center justify-center shadow-inner relative">
          <svg
            className="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* Title & Description */}
        <div className="space-y-2">
          <h2 id={titleId} className="text-xl font-extrabold text-[#071A2B] tracking-tight">
            {tr('auth-session.your_session_has_expired')}
          </h2>
          <p
            id={descriptionId}
            className="text-xs font-medium text-[#607A96] leading-relaxed max-w-xs mx-auto"
          >
            {tr(
              'auth-session.your_session_ended_automatically_for_security_please_sign_in_again_to_continue_wor',
            )}
          </p>
        </div>

        {/* Action Button */}
        <button
          ref={actionRef}
          type="button"
          onClick={onReLogin}
          className="w-full py-3 px-5 rounded-xl bg-[#071A2B] text-white text-xs font-bold shadow-[0_4px_16px_rgba(7,26,43,0.25)] hover:bg-[#F66B17] hover:shadow-[0_4px_16px_rgba(246,107,23,0.35)] transition-all duration-300 cursor-pointer flex items-center justify-center gap-2 group"
        >
          <span>{tr('common.sign_in_again')}</span>
          <svg
            className="w-4 h-4 text-white group-hover:translate-x-1 transition-transform"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Queries and Mutations

export function useRestoreSession(apiUrl: string) {
  const { setAccessToken } = useAuth();
  const lifecycle = useContext(AuthLifecycleContext);

  return useQuery({
    queryKey: ['auth', 'session', apiUrl],
    queryFn: async ({ signal }) => {
      if (hasLogoutIntent(apiUrl)) {
        setAccessToken(null);
        return null;
      }
      const capturedRevision = lifecycle.revision();
      const client = new SmartSiteManagementClient(apiUrl);
      try {
        const response = await client.refresh('WEB');
        if (signal.aborted || !lifecycle.isCurrent(capturedRevision)) return null;
        setAccessToken(response.accessToken);
        return true;
      } catch (error) {
        if (!signal.aborted && lifecycle.isCurrent(capturedRevision)) setAccessToken(null);
        throw error;
      }
    },
    enabled: lifecycle.canRestoreSession,
    retry: false, // Don't retry if the refresh token is missing or invalid
    staleTime: Infinity, // Only run once on mount
    refetchOnWindowFocus: false, // Prevent refetching on window tab focus when unauthenticated
    refetchOnReconnect: false,
  });
}

export function useLogin(apiUrl: string) {
  const { setAccessToken, dismissSessionExpired } = useAuth();
  const queryClient = useQueryClient();
  const lifecycle = useContext(AuthLifecycleContext);

  return useMutation({
    gcTime: 0,
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const capturedRevision = lifecycle.beginLogin();
      await queryClient.cancelQueries({ queryKey: ['auth', 'session'] });
      const client = new SmartSiteManagementClient(apiUrl);
      const data = await client.login(username, password, 'WEB');
      if (!lifecycle.isCurrent(capturedRevision))
        throw new ApiError('cancelled', 'Sign-in cancelled.');
      rememberLogoutIntent(apiUrl, false);
      dismissSessionExpired();
      setAccessToken(data.accessToken);
      // The bootstrap query needs only a marker, never a profile or token.
      queryClient.setQueryData(['auth', 'session', apiUrl], true);
      return data.user;
    },
  });
}

export function useLogout(apiUrl: string) {
  const { setAccessToken, dismissSessionExpired } = useAuth();
  const queryClient = useQueryClient();
  const lifecycle = useContext(AuthLifecycleContext);

  return useMutation({
    gcTime: 0,
    onMutate: () => {
      lifecycle.beginChange();
      rememberLogoutIntent(apiUrl, true);
      dismissSessionExpired();
      setAccessToken(null);
      queryClient.clear();
      queryClient.setQueryData(['auth', 'session', apiUrl], null);
    },
    mutationFn: async () => {
      const client = new SmartSiteManagementClient(apiUrl);
      return client.logout('WEB');
    },
  });
}

/**
 * useCurrentUser — fetches the authenticated user profile via GET /auth/me.
 *
 * Use this anywhere you need the user's role assignments or display name.
 * It will correctly re-fetch after a hard refresh once the accessToken is restored
 * by useRestoreSession. Never use useQuery(['auth','session']) without a queryFn
 * to read user data.
 */
export function useCurrentUser(apiUrl: string) {
  const { accessToken, sessionScope, triggerSessionExpired } = useAuth();
  const queryClient = useQueryClient();
  const prevScopeRef = useRef(sessionScope);

  useEffect(() => {
    if (prevScopeRef.current && prevScopeRef.current !== sessionScope) {
      queryClient.removeQueries({ queryKey: ['auth', 'me', apiUrl, prevScopeRef.current] });
    }
    prevScopeRef.current = sessionScope;
  }, [apiUrl, sessionScope, queryClient]);

  return useQuery<AccountResponse>({
    queryKey: ['auth', 'me', apiUrl, sessionScope],
    queryFn: async () => {
      const scopeAtCall = sessionScope;
      try {
        return await new SmartSiteManagementClient(apiUrl).me(accessToken!);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 401) {
          triggerSessionExpired(scopeAtCall);
        } else if (
          typeof err === 'object' &&
          err !== null &&
          ('status' in err || 'statusCode' in err)
        ) {
          const status =
            (err as { status?: number; statusCode?: number }).status ??
            (err as { statusCode?: number }).statusCode;
          if (status === 401) {
            triggerSessionExpired(scopeAtCall);
          }
        }
        throw err;
      }
    },
    enabled: !!accessToken && !!sessionScope,
    staleTime: 5 * 60 * 1000, // 5 min — role assignments rarely change during a session
    retry: false,
  });
}
