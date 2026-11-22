import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { IconChevronRight } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { colors } from '../../theme/colors';
import { allPages, localDate, minutes, validDates } from '../shared/data';
import { DateRangeFilter } from '../shared/date-range-filter';
import { Choice, Pager, QueryState } from '../shared/ui';
import { ManagementLink, ManagementSection } from '../shared/management-ui';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { WorkerAttendanceSummary } from '../attendance/worker-attendance-board';
import { AttendanceDetail } from '../attendance/attendance-day-detail';
import { AttendanceReport } from '../attendance/attendance-report';
import { EmptyState } from './contractor-presentation';

export function ContractorAttendancePanel({ initialDate }: { initialDate?: string }) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [range, setRange] = useState({
    fromDate: initialDate ?? `${localDate().slice(0, 8)}01`,
    toDate: initialDate ?? localDate(),
  });
  const [workerId, setWorkerId] = useState('');
  const [filters, setFilters] = useState(false);
  const [offset, setOffset] = useState(0);
  const [dayId, setDayId] = useState('');
  const workers = useScopedWorkers();
  const summary = useQuery({
    queryKey: [...queryKey, 'contractor-attendance-summary', range, workerId],
    enabled: workers.isSuccess,
    queryFn: () =>
      client.attendanceSummary(token, scope.siteId, {
        ...range,
        ...(workerId ? { workerId } : {}),
        contractorId: scope.contractorId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
  });
  const days = useQuery({
    queryKey: [...queryKey, 'contractor-attendance-days', range, workerId, offset],
    enabled: workers.isSuccess,
    queryFn: async ({ signal }) => {
      const ids = new Set(workers.data?.map((worker) => worker.id));
      const rows = (
        await allPages(
          (page) =>
            client.attendanceDays(token, scope.siteId, {
              ...range,
              ...page,
              ...(workerId ? { workerId } : {}),
            }),
          signal,
        )
      ).filter((day) => ids.has(day.workerId));
      return { items: rows.slice(offset, offset + 8), total: rows.length };
    },
  });
  if (dayId) return <AttendanceDetail dayId={dayId} onBack={() => setDayId('')} />;
  return (
    <>
      <ManagementSection
        title={t('attendance.attendanceHistory')}
        action={
          <ManagementLink label={t('requests.filter')} onPress={() => setFilters(!filters)} />
        }
      >
        {filters && (
          <View style={styles.filters}>
            <DateRangeFilter
              range={range}
              onValidate={(value) => validDates(value.fromDate, value.toDate)}
              onChange={(value) => {
                setRange(value);
                setOffset(0);
              }}
            />
            <QueryState query={workers}>
              {(rows) => (
                <Choice
                  label={t('schedule.worker')}
                  value={workerId}
                  onChange={(value) => {
                    setWorkerId(value);
                    setOffset(0);
                  }}
                  options={[
                    { value: '', label: t('common.all') },
                    ...rows.map((worker) => ({ value: worker.id, label: worker.displayName })),
                  ]}
                />
              )}
            </QueryState>
          </View>
        )}
        <QueryState query={summary}>
          {(data) => <WorkerAttendanceSummary summary={data} siteName={scope.siteName} />}
        </QueryState>
        <QueryState query={days}>
          {(data) => (
            <>
              {!data.items.length && (
                <EmptyState
                  title={t('attendance.noDaysInRange')}
                  hint={t('attendance.emptyHistoryHint')}
                />
              )}
              {data.items.map((day) => (
                <Pressable
                  key={day.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.workDate} ${day.workerName}`}
                  onPress={() => setDayId(day.id)}
                  style={styles.card}
                >
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{day.workerName}</Text>
                      <Text style={styles.hint}>
                        {day.workDate} · {day.shiftName ?? t('attendance.shiftNotAssigned')}
                      </Text>
                    </View>
                    <IconChevronRight size={18} color={colors.textTertiary} />
                  </View>
                  <View style={styles.row}>
                    <Text style={styles.hint}>{localizedLabel(day.status)}</Text>
                    <Text style={styles.value}>
                      {minutes(day.confirmedMinutes ?? day.provisionalMinutes)}
                    </Text>
                  </View>
                </Pressable>
              ))}
              {data.total > 8 && (
                <Pager offset={offset} total={data.total} size={8} onChange={setOffset} />
              )}
            </>
          )}
        </QueryState>
      </ManagementSection>
      <AttendanceReport
        key={`${range.fromDate}:${range.toDate}:${workerId}`}
        fromDate={range.fromDate}
        toDate={range.toDate}
        selectedWorkerId={workerId || undefined}
        onDay={setDayId}
      />
    </>
  );
}
const styles = StyleSheet.create({
  filters: { padding: 14, borderRadius: 16, backgroundColor: colors.surface, gap: 12 },
  card: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
  name: { color: colors.textPrimary, fontSize: 14, lineHeight: 22, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 20 },
  value: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
});
