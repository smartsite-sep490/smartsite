import { useQuery } from '@tanstack/react-query';
import type { SmartSiteManagementClient } from '@smartsite/api-client';

export function useGateCatalog(
  client: SmartSiteManagementClient,
  apiUrl: string,
  sessionScope: string,
  token: string | undefined,
  siteId: string,
  activeOnly = false,
) {
  return useQuery({
    queryKey: ['site-gates', apiUrl, sessionScope, siteId, activeOnly],
    enabled: !!token && !!siteId,
    queryFn: () => client.listAllSiteGates(token!, siteId, activeOnly ? 'ACTIVE' : undefined),
    refetchInterval: 15_000,
  });
}
