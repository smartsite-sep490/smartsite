import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, type AccountResponse, ApiError } from '@smartsite/api-client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// Create a context for the auth state so we don't have to prop-drill the token
type AuthState = {
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
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isSessionExpired, setIsSessionExpired] = useState(false);

  const triggerSessionExpired = useCallback(() => {
    setAccessToken((prev) => {
      if (prev !== null) {
        setIsSessionExpired(true);
      }
      return null;
    });
  }, []);

  const dismissSessionExpired = useCallback(() => {
    setIsSessionExpired(false);
  }, []);

  useEffect(() => {
    const handleExpiredEvent = () => {
      triggerSessionExpired();
    };
    window.addEventListener('smartsite:session-expired', handleExpiredEvent);
    return () => {
      window.removeEventListener('smartsite:session-expired', handleExpiredEvent);
    };
  }, [triggerSessionExpired]);

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        setAccessToken,
        isSessionExpired,
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
export function SessionExpiredModal({
  open,
  onReLogin,
}: {
  open: boolean;
  onReLogin: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#041D2E]/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#DCE6EF] shadow-[0_24px_64px_rgba(7,26,43,0.3)] p-6 sm:p-8 text-center space-y-5 relative overflow-hidden">
        {/* Top Decorative Amber Accent */}
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-24 bg-[#F66B17]/15 rounded-full blur-2xl pointer-events-none" />

        {/* Warning Badge Icon */}
        <div className="w-16 h-16 rounded-2xl bg-[#FFF7ED] border border-[#FFEDD5] text-[#F66B17] mx-auto flex items-center justify-center shadow-inner relative">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        {/* Title & Description */}
        <div className="space-y-2">
          <h2 className="text-xl font-extrabold text-[#071A2B] tracking-tight">
            Your session has expired
          </h2>
          <p className="text-xs font-medium text-[#607A96] leading-relaxed max-w-xs mx-auto">
            Your session ended automatically for security. Please sign in again to continue working on SmartSite.
          </p>
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={onReLogin}
          className="w-full py-3 px-5 rounded-xl bg-[#071A2B] text-white text-xs font-bold shadow-[0_4px_16px_rgba(7,26,43,0.25)] hover:bg-[#F66B17] hover:shadow-[0_4px_16px_rgba(246,107,23,0.35)] transition-all duration-300 cursor-pointer flex items-center justify-center gap-2 group"
        >
          <span>Sign in again</span>
          <svg className="w-4 h-4 text-white group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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

  return useQuery({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      const client = new SmartSiteManagementClient(apiUrl);
      try {
        const response = await client.refresh('WEB');
        setAccessToken(response.accessToken);
        return response;
      } catch (error) {
        setAccessToken(null);
        throw error;
      }
    },
    retry: false, // Don't retry if the refresh token is missing or invalid
    staleTime: Infinity, // Only run once on mount
    refetchOnWindowFocus: false, // Prevent refetching on window tab focus when unauthenticated
  });
}

export function useLogin(apiUrl: string) {
  const { setAccessToken, dismissSessionExpired } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const client = new SmartSiteManagementClient(apiUrl);
      return client.login(username, password, 'WEB');
    },
    onSuccess: (data) => {
      queryClient.clear();
      dismissSessionExpired();
      setAccessToken(data.accessToken);
      // Invalidate the session query so it updates if needed, though we just set the token manually
      queryClient.setQueryData(['auth', 'session'], data);
    },
  });
}

export function useLogout(apiUrl: string) {
  const { setAccessToken, dismissSessionExpired } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const client = new SmartSiteManagementClient(apiUrl);
      return client.logout('WEB');
    },
    onSuccess: () => {
      dismissSessionExpired();
      setAccessToken(null);
      queryClient.setQueryData(['auth', 'session'], null);
      queryClient.clear(); // Clear all cached data on logout
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
  const { accessToken, triggerSessionExpired } = useAuth();
  return useQuery<AccountResponse>({
    queryKey: ['auth', 'me', apiUrl],
    queryFn: async () => {
      try {
        return await new SmartSiteManagementClient(apiUrl).me(accessToken!);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 401) {
          triggerSessionExpired();
        } else if (typeof err === 'object' && err !== null && ('status' in err || 'statusCode' in err)) {
          const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
          if (status === 401) {
            triggerSessionExpired();
          }
        }
        throw err;
      }
    },
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000, // 5 min — role assignments rarely change during a session
    retry: false,
  });
}
