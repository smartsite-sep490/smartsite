import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation, uiLocale } from '../../i18n';
import { colors } from '../../theme/colors';
import { IconChevronRight } from '../../components/common/Icons';
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('attendance.dayDetail')}
            onPress={() => onDay(data.day.id)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.65 }]}
          >
            <View style={styles.heading}>
              <View style={styles.headingCopy}>
                <Text style={styles.eyebrow}>{t('attendanceUi.todayOverview')}</Text>
                <Text style={styles.shift}>
                  {data.day.shiftName ?? t('attendance.shiftNotAssigned')}
                </Text>
              </View>
              <View style={styles.total}>
                <Text style={styles.hours}>
                  {minutes(data.day.confirmedMinutes ?? data.day.provisionalMinutes)}
                </Text>
                <Text style={styles.label}>
                  {t(
                    data.day.confirmedMinutes === null
                      ? 'attendance.provisionalHours'
                      : 'attendance.confirmedHours',
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
            <View style={styles.footer}>
              <Text style={styles.presenceText}>
                {t(
                  data.day.presence === 'INSIDE'
                    ? 'attendance.insideSite'
                    : 'attendance.outsideSite',
                )}
              </Text>
              <Text style={styles.detailText}>{t('attendance.dayDetail')}</Text>
              <IconChevronRight size={14} color={colors.primary} />
            </View>
          </Pressable>
        );
      }}
    </QueryState>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headingCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { fontSize: 11, fontWeight: '600', color: colors.primary },
  shift: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, lineHeight: 21 },
  presenceText: { fontSize: 11, color: colors.textMuted, flex: 1 },
  caption: { color: colors.textMuted, fontSize: 11 },
  times: { flexDirection: 'row', gap: 12 },
  timeCol: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surfaceSubtle,
    padding: 9,
    borderRadius: 10,
  },
  label: { fontSize: 11, lineHeight: 17, color: colors.textSecondary },
  clock: { fontSize: 17, lineHeight: 23, color: colors.textPrimary, fontWeight: '700' },
  missing: { color: colors.warningText },
  date: { fontSize: 10, lineHeight: 16, color: colors.textMuted },
  total: { alignItems: 'flex-end', maxWidth: '48%', gap: 2 },
  hours: { color: colors.textPrimary, fontSize: 21, lineHeight: 28, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailText: { color: colors.primary, fontSize: 11, fontWeight: '600' },
});
