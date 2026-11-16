import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import { useManagementClient } from '../auth/auth-session';

const previewLimit = 3;

export function usePpeFrameInboxPreview({
  apiUrl,
  token,
  userId,
  siteIds,
  enabled,
}: {
  apiUrl: string;
  token: string | null;
  userId: string;
  siteIds: readonly string[];
  enabled: boolean;
}) {
  const client = useManagementClient(apiUrl);
  const sites = [...new Set(siteIds.map((id) => id.toLowerCase()))].sort();
  const siteScope = sites.join(',');
  const credentialScope = useMemo(
    () => ({ token, apiUrl, userId, siteScope, id: crypto.randomUUID() }),
    [token, apiUrl, userId, siteScope],
  );
  return useQuery({
    queryKey: ['notification-bell-ppe-inbox', credentialScope.id],
    queryFn: ({ signal }) =>
      client.listSafetyFrameInbox(
        credentialScope.token!,
        { limit: previewLimit },
        { signal, timeoutMs: 10_000 },
      ),
    enabled: enabled && !!token && sites.length > 0,
    refetchInterval: (query) =>
      query.state.error instanceof ApiError &&
      [401, 403, 404].includes(query.state.error.status ?? 0)
        ? false
        : 15_000,
    refetchIntervalInBackground: false,
    retry: false,
    gcTime: 0,
  });
}
