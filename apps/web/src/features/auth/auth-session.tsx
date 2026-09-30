import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SmartSiteManagementClient, type AccountResponse } from '@smartsite/api-client';
import { createContext, useContext, useState } from 'react';

// Create a context for the auth state so we don't have to prop-drill the token
type AuthState = {
  accessToken: string | null;
  mustChangePassword?: boolean;
  setAccessToken: (token: string | null) => void;
};

export const AuthContext = createContext<AuthState>({
  accessToken: null,
  setAccessToken: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  
  // Note: We don't store the refresh token in state or localStorage. 
  // It is handled automatically as an HTTP-only cookie by the browser.

  return (
    <AuthContext.Provider value={{ accessToken, setAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
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
  });
}

export function useLogin(apiUrl: string) {
  const { setAccessToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const client = new SmartSiteManagementClient(apiUrl);
      return client.login(username, password, 'WEB');
    },
    onSuccess: (data) => {
      setAccessToken(data.accessToken);
      // Invalidate the session query so it updates if needed, though we just set the token manually
      queryClient.setQueryData(['auth', 'session'], data);
    },
  });
}

export function useLogout(apiUrl: string) {
  const { setAccessToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const client = new SmartSiteManagementClient(apiUrl);
      return client.logout('WEB');
    },
    onSuccess: () => {
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
  const { accessToken } = useAuth();
  return useQuery<AccountResponse>({
    queryKey: ['auth', 'me', apiUrl],
    queryFn: () => new SmartSiteManagementClient(apiUrl).me(accessToken!),
    enabled: !!accessToken,
    staleTime: 5 * 60 * 1000, // 5 min — role assignments rarely change during a session
    retry: false,
  });
}
