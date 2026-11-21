import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../workspace/workspace-context';
import { displayTime } from '../shared/data';
import { translate as t } from '../../i18n';

export function useWorkerLeaveAvailability(enabled: boolean) {
  const { client, token, scope, queryKey } = useWorkspace();
  const active = enabled && scope.role === 'worker';
  const query = useQuery({
    queryKey: [...queryKey, 'worker-request-availability'],
    queryFn: () => client.myWorkerRequests(token, scope.siteId, { limit: 1 }),
    enabled: active,
    refetchInterval: 15000,
    staleTime: 0,
  });
  const { refetch } = query;
  const [now, setNow] = useState(() => Date.now());
  const availableAt = query.data?.leaveAvailableAt;
  const serverNow = query.data
    ? Date.parse(query.data.serverTime) + Math.max(0, now - query.dataUpdatedAt)
    : now;
  const locked = !!availableAt && Date.parse(availableAt) > serverNow;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNow(Date.now());
        void refetch();
      }
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [active, refetch]);
  return {
    ready: !active || (query.isSuccess && !query.isRefetchError),
    locked: active && locked,
    message:
      active && locked
        ? t('workerRequests.leaveCooldown', { time: displayTime(availableAt!) })
        : '',
    error: active ? query.error : null,
  };
}
