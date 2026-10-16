import { useManagementClient } from '../../../features/auth/auth-session';
import { useQuery } from '@tanstack/react-query';
import { type ShiftRequestListOptions } from '@smartsite/api-client';
import { WORKFORCE_POLL_INTERVAL_MS } from '../constants/workforce.constants';

export function useShiftRequests(
  apiUrl: string,
  siteId: string,
  token: string,
  options: ShiftRequestListOptions,
) {
  const client = useManagementClient(apiUrl);
  return useQuery({
    queryKey: ['shift-requests', apiUrl, siteId, options],
    queryFn: () => client.listShiftRequests(token, siteId, options),
    refetchInterval: WORKFORCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
