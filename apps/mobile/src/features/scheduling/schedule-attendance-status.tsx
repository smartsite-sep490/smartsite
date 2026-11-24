import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../workspace/workspace-context';
import { QueryState } from '../shared/ui';
import { RollCallBadge } from './schedule-day-sheet';

export function ScheduleAttendanceStatus({ scheduleId }: { scheduleId: string }) {
  const { client, token, scope, queryKey } = useWorkspace();
  const query = useQuery({
    queryKey: [...queryKey, 'zone-attendance', scheduleId],
    queryFn: () => client.scheduleTeamAttendance(token, scope.siteId, scheduleId),
    refetchInterval: 15000,
  });
  return (
    <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
      <QueryState query={query}>{(data) => <RollCallBadge status={data.own.status} />}</QueryState>
    </View>
  );
}
