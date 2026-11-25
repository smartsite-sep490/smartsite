import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { AttendanceOverviewResponse } from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { useWorkspace } from '../workspace/workspace-context';
import { Button, Hint, QueryState } from '../shared/ui';
import { colors } from '../../theme/colors';
import { CorrectionModal } from './correction-modal';
import { AttendanceCorrectionHistory, AttendanceDisclosure } from './attendance-day-view';

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
  const missingSchedules = (query.data?.missingSchedules ?? []).filter(
    (s) => (!fromDate || s.workDate >= fromDate) && (!toDate || s.workDate <= toDate),
  );
  const rows = missingSchedules.map((schedule) => (
    <View key={schedule.scheduleId} style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.title}>{schedule.shiftName}</Text>
        <Text style={styles.date}>{schedule.workDate}</Text>
      </View>
      {allowed && (
        <Button
          secondary
          label={t('attendance.requestMissing')}
          onPress={() => {
            setSelected(schedule);
            setSent(false);
          }}
        />
      )}
    </View>
  ));
  return (
    <View style={{ gap: 12 }}>
      {sent && <Hint>{t('attendance.adjustmentSuccess')}</Hint>}
      <QueryState query={query}>
        {(data) => (
          <>
            {rows.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.title}>{t('attendance.requestMissing')}</Text>
                {rows.length > 1 ? (
                  <AttendanceDisclosure
                    title={t('attendanceDetail.missingShifts', { count: rows.length })}
                  >
                    {rows}
                  </AttendanceDisclosure>
                ) : (
                  rows
                )}
              </View>
            )}
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

const styles = StyleSheet.create({
  card: { padding: 12, borderRadius: 14, backgroundColor: colors.surface, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  copy: { flexGrow: 1, flexBasis: 140, gap: 3 },
  title: { fontSize: 12, lineHeight: 19, fontWeight: '600', color: colors.textPrimary },
  date: { fontSize: 11, lineHeight: 17, color: colors.textMuted },
});
