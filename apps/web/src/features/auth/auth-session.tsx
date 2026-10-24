import { translate as tr } from '../../i18n/runtime';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, ApiError, type AccountResponse } from '@smartsite/api-client';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useId,
  useSyncExternalStore,
} from 'react';
import { WebSession } from './web-session';

type AuthState = {
  manager?: WebSession;
  epoch?: number;
  logoutUnconfirmed?: boolean;
  passwordChanged?: boolean;
  accessToken: string | null;
  sessionScope?: string;
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

export function AuthProvider({
  children,
  apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000',
}: {
  children: React.ReactNode;
  apiUrl?: string;
}) {
  const queryClient = useQueryClient();
  const manager = useMemo(() => new WebSession(apiUrl), [apiUrl]);
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const sessionScope = state.sessionScope;
  useEffect(() => {
    let epoch = manager.getSnapshot().epoch;
    const unsubscribe = manager.subscribe(() => {
      if (epoch === manager.getSnapshot().epoch) return;
      epoch = manager.getSnapshot().epoch;
      void queryClient.cancelQueries();
      queryClient.clear();
    });
    return unsubscribe;
  }, [manager, queryClient]);
  const setAccessToken = useCallback(
    (token: string | null) => manager.setAccessToken(token),
    [manager],
  );
  const triggerSessionExpired = useCallback(
    (expiredScope = sessionScope) => {
      const token = manager.getSnapshot().token;
      if (!token || !expiredScope || expiredScope !== manager.getSnapshot().sessionScope) return;
      manager.adapter().onUnauthorized(token);
    },
    [manager, sessionScope],
  );
  const dismissSessionExpired = useCallback(() => manager.dismissExpired(), [manager]);
  useLayoutEffect(() => {
    manager.connect();
    const expired = (event: Event) => {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== 'object')
        return;
      const scopes: unknown = event.detail.sessionScopes;
      const currentScope = manager.getSnapshot().sessionScope;
      const token = manager.getSnapshot().token;
      if (token && currentScope && Array.isArray(scopes) && scopes.includes(currentScope))
        manager.adapter().onUnauthorized(token);
    };
    window.addEventListener('smartsite:session-expired', expired);
    return () => {
      window.removeEventListener('smartsite:session-expired', expired);
      manager.dispose();
    };
  }, [manager]);
  return (
    <AuthContext.Provider
      value={{
        manager,
        epoch: state.epoch,
        logoutUnconfirmed: state.logoutUnconfirmed,
        passwordChanged: state.passwordChanged,
        accessToken: state.token,
        sessionScope,
        setAccessToken,
        isSessionExpired: state.expired,
        triggerSessionExpired,
        dismissSessionExpired,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}

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

export function useManagementClient(apiUrl: string) {
  const { manager, epoch } = useAuth();
  return useMemo(
    () => new SmartSiteManagementClient(apiUrl, manager?.adapter(epoch)),
    [apiUrl, manager, epoch],
  );
}

export function useRestoreSession(apiUrl: string) {
  const { manager, epoch, accessToken, setAccessToken } = useAuth();
  return useQuery({
    queryKey: ['auth', 'session', apiUrl, epoch ?? 0],
    enabled: !accessToken && (!manager || manager.canRestore()),
    queryFn: async ({ signal }) => {
      if (manager) return (await manager.restore()) ? true : null;
      try {
        if (
          sessionStorage.getItem('smartsite:signed-out') ||
          sessionStorage.getItem(`smartsite:logout:${apiUrl.replace(/\/+$/, '')}`)
        )
          return null;
      } catch {
        /* Storage may be disabled; the in-memory provider remains authoritative. */
      }
      const response = await new SmartSiteManagementClient(apiUrl).refresh('WEB', undefined, {
        signal,
      });
      if (signal.aborted) return null;
      setAccessToken(response.accessToken);
      return true;
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useLogin(apiUrl: string) {
  const { manager, setAccessToken, dismissSessionExpired } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const response = manager
        ? await manager.login(username, password)
        : await new SmartSiteManagementClient(apiUrl).login(username, password, 'WEB');
      try {
        sessionStorage.removeItem('smartsite:signed-out');
        sessionStorage.removeItem(`smartsite:logout:${apiUrl.replace(/\/+$/, '')}`);
      } catch {
        /* Authentication does not require browser storage. */
      }
      if (!manager) {
        queryClient.clear();
        setAccessToken(response.accessToken);
      }
      dismissSessionExpired();
      queryClient.setQueryData(
        ['auth', 'session', apiUrl, manager?.getSnapshot().epoch ?? 0],
        true,
      );
      return response.user;
    },
  });
}

export function useLogout(apiUrl: string) {
  const { manager, setAccessToken, dismissSessionExpired } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async () => {
      if (manager) return manager.logout();
      try {
        sessionStorage.setItem('smartsite:signed-out', 'true');
        sessionStorage.setItem(`smartsite:logout:${apiUrl.replace(/\/+$/, '')}`, '1');
      } catch {
        /* Local credentials still clear synchronously below. */
      }
      dismissSessionExpired();
      setAccessToken(null);
      void queryClient.cancelQueries();
      queryClient.clear();
      return new SmartSiteManagementClient(apiUrl).logout('WEB');
    },
  });
}

export function useCurrentUser(apiUrl: string) {
  const { accessToken, sessionScope, triggerSessionExpired } = useAuth();
  const client = useManagementClient(apiUrl);
  return useQuery<AccountResponse>({
    queryKey: ['auth', 'me', apiUrl, sessionScope],
    queryFn: async ({ signal }) => {
      try {
        return await client.me(accessToken!, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) triggerSessionExpired(sessionScope);
        throw error;
      }
    },
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
