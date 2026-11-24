import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceOverviewResponse } from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { useWorkspace } from '../workspace/workspace-context';
import { Body, Button, Hint, QueryState } from '../shared/ui';
import { CorrectionModal } from './correction-modal';
import { AttendanceCorrectionHistory } from './attendance-day-view';

type MissingSchedule = NonNullable<AttendanceOverviewResponse['missingSchedules']>[number];

export function MissingAttendance({
  dayId,
  fromDate,
  toDate,
}: {
  dayId?: string;
  fromDate?: string;
  toDate?: string;
}) {
  const { t } = useTranslation();
  const { client, scope, token, queryKey } = useWorkspace();
  const [selected, setSelected] = useState<MissingSchedule | null>(null);
  const [sent, setSent] = useState(false);
  const query = useQuery({
    queryKey: [...queryKey, 'missing-attendance', dayId],
    queryFn: () => client.attendanceOverview(token, scope.siteId, dayId ? { dayId } : {}),
    enabled: scope.role === 'worker',
  });
  if (scope.role !== 'worker') return null;
  const allowed =
    !!query.data?.canRequestCorrection &&
    !query.data.hasPendingCorrection &&
    !query.data.corrections.some((c) => c.status === 'PENDING') &&
    !query.isError;
  return (
    <View style={{ gap: 12 }}>
      {sent && <Hint>{t('attendance.adjustmentSuccess')}</Hint>}
      <QueryState query={query}>
        {(data) => (
          <>
            {(data.missingSchedules ?? [])
              .filter(
                (s) => (!fromDate || s.workDate >= fromDate) && (!toDate || s.workDate <= toDate),
              )
              .map((schedule) => (
                <View key={schedule.scheduleId} style={{ gap: 8 }}>
                  <Body>
                    {schedule.workDate} · {schedule.shiftName}
                  </Body>
                  <Hint>{t('attendance.missingHint')}</Hint>
                  {allowed && (
                    <Button
                      label={t('attendance.requestMissing')}
                      onPress={() => {
                        setSelected(schedule);
                        setSent(false);
                      }}
                    />
                  )}
                </View>
              ))}
            {!dayId && (
              <AttendanceCorrectionHistory
                data={data}
                workDate=""
                timezone={Intl.DateTimeFormat().resolvedOptions().timeZone}
              />
            )}
          </>
        )}
      </QueryState>
      {selected && (
        <CorrectionModal
          key={selected.scheduleId}
          missing={selected}
          disabled={
            !allowed ||
            !query.data?.missingSchedules?.some((s) => s.scheduleId === selected.scheduleId)
          }
          timezone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          visible
          onClose={() => setSelected(null)}
          onSubmitted={() => setSent(true)}
        />
      )}
    </View>
  );
}
