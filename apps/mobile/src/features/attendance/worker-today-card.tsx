import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation, uiLocale } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { localDate, minutes } from '../shared/data';
import { QueryState } from '../shared/ui';

export function WorkerTodayCard({ dayId, onDay }: { dayId?: string; onDay: (id: string) => void }) {
  const { t } = useTranslation();
  const { client, token, scope, workerId, queryKey } = useWorkspace();
  const query = useQuery({
    queryKey: [...queryKey, 'day', dayId],
    queryFn: () => client.attendanceDayDetail(token, scope.siteId, dayId!),
    enabled: scope.role === 'worker' && !!dayId,
    refetchInterval: 30000,
  });
  if (!dayId) return null;
  return (
    <QueryState query={query}>
      {(data) => {
        if (data.day.workerId !== workerId || data.day.workDate !== localDate()) return null;
        const timestamp = (value: string | null | undefined) =>
          value ? Date.parse(value) || 0 : 0;
        const last = [...data.sessions]
          .filter((s) => s.status !== 'IGNORED_DUPLICATE')
          .sort(
            (a, b) =>
              timestamp(a.effectiveInAt ?? a.rawInAt ?? a.effectiveOutAt ?? a.rawOutAt) -
              timestamp(b.effectiveInAt ?? b.rawInAt ?? b.effectiveOutAt ?? b.rawOutAt),
          )
          .at(-1);
        const entry = last?.effectiveInAt ?? last?.rawInAt;
        const exit = last?.effectiveOutAt ?? last?.rawOutAt;
        return (
          <View style={styles.card}>
            <View style={styles.heading}>
              <View style={styles.headingCopy}>
                <Text style={styles.eyebrow}>{t('attendanceUi.todayOverview')}</Text>
                <Text style={styles.shift}>
                  {data.day.shiftName ?? t('attendance.shiftNotAssigned')}
                </Text>
              </View>
              <View style={styles.presence}>
                <Text style={styles.presenceText}>
                  {t(
                    data.day.presence === 'INSIDE'
                      ? 'attendance.insideSite'
                      : 'attendance.outsideSite',
                  )}
                </Text>
              </View>
            </View>
            <Text style={styles.caption}>{t('attendanceUi.latestSession')}</Text>
            <View style={styles.times}>
              {[
                { label: t('attendance.checkIn'), value: entry },
                { label: t('attendance.checkOut'), value: exit },
              ].map(({ label, value }) => (
                <View key={label} style={styles.timeCol}>
                  <Text style={styles.label}>{label}</Text>
                  <Text style={[styles.clock, !value && styles.missing]}>
                    {value
                      ? new Date(value).toLocaleTimeString(uiLocale(), {
                          timeZone: data.day.timezone,
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })
                      : '—'}
                  </Text>
                  <Text style={styles.date}>
                    {value
                      ? new Date(value).toLocaleDateString(uiLocale(), {
                          timeZone: data.day.timezone,
                          day: '2-digit',
                          month: '2-digit',
                        })
                      : t('attendanceUi.notRecorded')}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.total}>
              <Text style={styles.label}>
                {t(
                  data.day.confirmedMinutes === null
                    ? 'attendance.provisionalHours'
                    : 'attendance.confirmedHours',
                )}
              </Text>
              <Text style={styles.hours}>
                {minutes(data.day.confirmedMinutes ?? data.day.provisionalMinutes)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('attendance.dayDetail')}
              onPress={() => onDay(data.day.id)}
              style={styles.detail}
            >
              <Text style={styles.detailText}>{t('attendance.dayDetail')} →</Text>
            </Pressable>
          </View>
        );
      }}
    </QueryState>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.slateNavy, borderRadius: 22, padding: 20, gap: 16 },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  headingCopy: { flex: 1, minWidth: 130 },
  eyebrow: { fontSize: 12, fontWeight: '700', color: '#FDBA74', marginBottom: 5 },
  shift: { fontSize: 18, fontWeight: '800', color: '#FFFFFF', lineHeight: 25 },
  presence: {
    backgroundColor: '#243449',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  presenceText: { fontSize: 11, fontWeight: '600', color: '#FFFFFF' },
  caption: { color: '#CBD5E1', fontSize: 12, marginBottom: -5 },
  times: { flexDirection: 'row', gap: 12 },
  timeCol: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#17283D',
    padding: 14,
    borderRadius: 15,
    gap: 5,
  },
  label: { fontSize: 12, lineHeight: 18, color: '#CBD5E1' },
  clock: { fontSize: 28, lineHeight: 36, color: '#FFFFFF', fontWeight: '800' },
  missing: { color: '#FDBA74' },
  date: { fontSize: 11, lineHeight: 17, color: '#CBD5E1' },
  total: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  hours: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  detail: {
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    justifyContent: 'center',
    paddingTop: 12,
  },
  detailText: { color: '#FDBA74', fontSize: 13, fontWeight: '700' },
});
