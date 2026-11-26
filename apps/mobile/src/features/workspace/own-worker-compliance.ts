import { queryOptions } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';

export function ownWorkerComplianceOptions(
  client: SmartSiteManagementClient,
  token: string,
  siteId: string,
  queryKey: readonly unknown[],
) {
  return queryOptions({
    queryKey: [...queryKey, 'worker-documents', 'self'],
    queryFn: async ({ signal }) => {
      try {
        return await client.myWorkerCompliance(token, siteId, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}
