import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { WORKFORCE_POLL_INTERVAL_MS } from '../constants/workforce.constants';

export function useNotificationRequest(apiUrl: string, siteId: string, token: string) {
  const [params] = useSearchParams();
  const requestId = params.get('requestId');
  const requestType = params.get('requestType');
  return useQuery({
    queryKey: ['notification-request', apiUrl, siteId, requestType, requestId],
    enabled: !!requestId && (requestType === 'CHANGE' || requestType === 'SWAP'),
    queryFn: async () => {
      const client = new SmartSiteManagementClient(apiUrl);
      return requestType === 'CHANGE'
        ? {
            ...(await client.getShiftChangeRequest(token, siteId, requestId!)),
            requestType: 'CHANGE' as const,
          }
        : {
            ...(await client.getShiftSwapRequest(token, siteId, requestId!)),
            requestType: 'SWAP' as const,
          };
    },
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
}
