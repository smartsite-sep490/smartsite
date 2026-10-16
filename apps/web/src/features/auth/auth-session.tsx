import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, type AccountResponse } from '@smartsite/api-client';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from 'react';

import { WebSession } from './web-session';

// Create a context for the auth state so we don't have to prop-drill the token
type AuthState = {
  manager?: WebSession;
  epoch?: number;
  logoutUnconfirmed?: boolean;
  passwordChanged?: boolean;
  accessToken: string | null;
  mustChangePassword?: boolean;
  setAccessToken: (token: string | null) => void;
  isSessionExpired: boolean;
  triggerSessionExpired: () => void;
  dismissSessionExpired: () => void;
};

export const AuthContext = createContext<AuthState>({
  accessToken: null,
  setAccessToken: () => {},
  isSessionExpired: false,
  triggerSessionExpired: () => {},
  dismissSessionExpired: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [manager] = useState(
    () => new WebSession(import.meta.env.VITE_API_URL || 'http://localhost:3000'),
  );
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  useEffect(() => {
    let epoch = manager.getSnapshot().epoch;
    const unsubscribe = manager.subscribe(() => {
      if (epoch === manager.getSnapshot().epoch) return;
      epoch = manager.getSnapshot().epoch;
      void queryClient.cancelQueries();
      queryClient.clear();
    });
    manager.connect();
    return () => {
      unsubscribe();
      manager.dispose();
    };
  }, [manager, queryClient]);
  const setAccessToken = useCallback(
    (token: string | null) => {
      manager.setAccessToken(token);
    },
    [manager],
  );
  const triggerSessionExpired = useCallback(() => {
    const token = manager.getSnapshot().token;
    if (token) manager.adapter().onUnauthorized(token);
  }, [manager]);
  const dismissSessionExpired = useCallback(() => manager.dismissExpired(), [manager]);
  return (
    <AuthContext.Provider
      value={{
        manager,
        epoch: state.epoch,
        logoutUnconfirmed: state.logoutUnconfirmed,
        passwordChanged: state.passwordChanged,
        accessToken: state.token,
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

// ── Session Expired Luxury Modal ──────────────────────────────────────────────
export function SessionExpiredModal({ open, onReLogin }: { open: boolean; onReLogin: () => void }) {
  useTranslation();

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expired-heading"
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          event.currentTarget.querySelector('button')?.focus();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#041D2E]/80 backdrop-blur-md animate-in fade-in duration-300"
    >
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE6EF] shadow-[0_24px_64px_rgba(7,26,43,0.3)] p-6 sm:p-8 text-center space-y-5 relative overflow-hidden">
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
          <h2
            id="session-expired-heading"
            className="text-xl font-extrabold text-[#071A2B] tracking-tight"
          >
            {tr('auth-session.your_session_has_expired')}
          </h2>
          <p className="text-xs font-medium text-[#607A96] leading-relaxed max-w-xs mx-auto">
            {tr(
              'auth-session.your_session_ended_automatically_for_security_please_sign_in_again_to_continue_wor',
            )}
          </p>
        </div>

        {/* Action Button */}
        <button
          type="button"
          autoFocus
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

export function useManagementClient(apiUrl: string) {
  const { manager, epoch } = useAuth();
  return useMemo(
    () => new SmartSiteManagementClient(apiUrl, manager?.adapter(epoch)),
    [apiUrl, manager, epoch],
  );
}

export function useRestoreSession(apiUrl: string) {
  const { manager, epoch, setAccessToken } = useAuth();
  return useQuery({
    queryKey: manager ? ['auth', 'session', apiUrl, epoch] : ['auth', 'session'],
    enabled: !manager || manager.canRestore(),
    queryFn: async () => {
      if (manager) return manager.restore();
      if (sessionStorage.getItem('smartsite:signed-out')) return null;
      const response = await new SmartSiteManagementClient(apiUrl).refresh('WEB');
      setAccessToken(response.accessToken);
      return response;
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
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      manager
        ? manager.login(username, password)
        : new SmartSiteManagementClient(apiUrl).login(username, password, 'WEB'),
    onSuccess: (data) => {
      sessionStorage.removeItem('smartsite:signed-out');
      if (!manager) {
        queryClient.clear();
        setAccessToken(data.accessToken);
      }
      dismissSessionExpired();
      queryClient.setQueryData(
        manager ? ['auth', 'session', apiUrl, manager.getSnapshot().epoch] : ['auth', 'session'],
        data,
      );
      queryClient.setQueryData(['auth', 'me', apiUrl], data.user);
    },
  });
}

export function useLogout(apiUrl: string) {
  const { manager, setAccessToken, dismissSessionExpired } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (manager) return manager.logout();
      sessionStorage.setItem('smartsite:signed-out', 'true');
      dismissSessionExpired();
      setAccessToken(null);
      void queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(['auth', 'session'], null);
      return new SmartSiteManagementClient(apiUrl).logout('WEB');
    },
  });
}

export function useCurrentUser(apiUrl: string) {
  const { accessToken } = useAuth();
  const client = useManagementClient(apiUrl);
  return useQuery<AccountResponse>({
    queryKey: ['auth', 'me', apiUrl],
    queryFn: () => client.me(accessToken!),
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
