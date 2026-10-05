import { useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient, type ShiftRequestListOptions } from '@smartsite/api-client';
import { WORKFORCE_POLL_INTERVAL_MS } from './WorkforceSharedUI';

export function useShiftRequests(
  apiUrl: string,
  siteId: string,
  token: string,
  options: ShiftRequestListOptions,
) {
  return useQuery({
    queryKey: ['shift-requests', apiUrl, siteId, options],
    queryFn: () => new SmartSiteManagementClient(apiUrl).listShiftRequests(token, siteId, options),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
