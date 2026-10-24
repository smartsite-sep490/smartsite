// @vitest-environment jsdom
import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AuthProvider, useAuth, useCurrentUser } from './auth-session';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';

describe('auth-session Provider Scope & Cache Isolation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('rotates sessionScope on each accessToken change without containing token in cache key', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.accessToken).toBeNull();
    expect(result.current.sessionScope).toBe('');

    // Set first token
    act(() => {
      result.current.setAccessToken('token-aaa');
    });

    const firstScope = result.current.sessionScope;
    expect(firstScope).toBeTruthy();
    expect(firstScope).not.toContain('token-aaa');

    // Rotate to same-account or new token
    act(() => {
      result.current.setAccessToken('token-bbb');
    });

    const secondScope = result.current.sessionScope;
    expect(secondScope).toBeTruthy();
    expect(secondScope).not.toBe(firstScope);
    expect(secondScope).not.toContain('token-bbb');

    // Clear token
    act(() => {
      result.current.setAccessToken(null);
    });
    expect(result.current.sessionScope).toBe('');
  });

  it('scopes useCurrentUser queryKey by sessionScope and does not reuse stale user profile across token change', async () => {
    let mockAccount = {
      id: 'user-1',
      username: 'userone',
      displayName: 'User One',
      roleAssignments: [{ role: 'ADMIN', siteId: null as string | null }],
      isActive: true,
    };

    vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockImplementation(async () => {
      return mockAccount as never;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => {
        const auth = useAuth();
        const user = useCurrentUser('http://localhost:3000');
        return { auth, user };
      },
      { wrapper },
    );

    // Initial: no token -> user query disabled
    expect(result.current.user.data).toBeUndefined();

    // Login user 1
    act(() => {
      result.current.auth.setAccessToken('token-user-1');
    });

    await waitFor(() => {
      expect(result.current.user.data?.displayName).toBe('User One');
    });

    // Switch account to user 2
    mockAccount = {
      id: 'user-2',
      username: 'usertwo',
      displayName: 'User Two',
      roleAssignments: [{ role: 'WORKER', siteId: 'site-beta' }],
      isActive: true,
    };

    act(() => {
      result.current.auth.setAccessToken('token-user-2');
    });

    // Must NOT return cached "User One"
    await waitFor(() => {
      expect(result.current.user.data?.displayName).toBe('User Two');
    });
  });

  it('guards late 401 response from prior sessionScope from expiring current session', async () => {
    let rejectPriorMe: (err: unknown) => void = () => {};
    let priorSettled = false;

    vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockImplementation(async (token) => {
      if (token === 'token-old') {
        return new Promise((_, reject) => {
          rejectPriorMe = (err) => {
            priorSettled = true;
            reject(err);
          };
        });
      }
      return {
        id: 'new-user',
        username: 'newuser',
        displayName: 'New User',
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
        isActive: true,
      } as never;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );

    const { result } = renderHook(
      () => {
        const auth = useAuth();
        const user = useCurrentUser('http://localhost:3000');
        return { auth, user };
      },
      { wrapper },
    );

    // Login with old token
    act(() => {
      result.current.auth.setAccessToken('token-old');
    });

    // Session rotates to new token BEFORE old query completes
    act(() => {
      result.current.auth.setAccessToken('token-new');
    });

    await waitFor(() => {
      expect(result.current.user.data?.displayName).toBe('New User');
    });

    // Now prior query rejects with 401 late
    await act(async () => {
      rejectPriorMe(new ApiError('http', 'Unauthorized', 401));
      await new Promise((r) => setTimeout(r, 20));
    });

    // Prove old response actually settled
    expect(priorSettled).toBe(true);

    // Current session MUST NOT be expired by the late 401 of the previous scope!
    expect(result.current.auth.isSessionExpired).toBe(false);
    expect(result.current.auth.accessToken).toBe('token-new');
  });
});
