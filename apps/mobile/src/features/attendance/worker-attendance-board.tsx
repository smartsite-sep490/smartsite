import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AttendanceDayResponse, AttendanceSummaryResponse } from '@smartsite/api-client';
import { useTranslation, uiLocale } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { IconChevronRight } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { minutes } from '../shared/data';
import { AttendanceNotices } from './attendance-notices';

export function WorkerAttendanceSummary({
  summary,
  siteName,
}: {
  summary: AttendanceSummaryResponse;
  siteName: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.summary}>
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('attendance.overview')}
        </Text>
        <Text style={styles.caption}>{siteName}</Text>
      </View>
      <View style={styles.totals}>
        <View style={styles.metric}>
          <Text style={styles.label}>{t('attendance.confirmedHours')}</Text>
          <Text style={styles.total}>{minutes(summary.totalMinutes)}</Text>
          <Text style={styles.caption}>
            {t('attendance.includesOvertime', { hours: minutes(summary.overtimeMinutes) })}
          </Text>
        </View>
        <View style={styles.metric}>
          <Text style={styles.label}>{t('attendance.provisionalHours')}</Text>
          <Text style={styles.estimateValue}>{minutes(summary.provisionalMinutes)}</Text>
        </View>
      </View>
      <View style={styles.dayCounts}>
        {[
          { label: t('attendance.presentDaysLabel'), count: summary.presentDays },
          { label: t('attendance.absentDaysLabel'), count: summary.absentDays },
          { label: t('attendance.reviewDaysLabel'), count: summary.reviewDays },
        ].map(({ label, count }, index) => (
          <View key={label} style={[styles.count, index > 0 && styles.countDivider]}>
            <Text style={[styles.countValue, index === 2 && count > 0 && styles.reviewText]}>
              {count}
            </Text>
            <Text style={styles.countLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function WorkerAttendanceDay({
  day,
  onPress,
}: {
  day: AttendanceDayResponse;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const confirmed = day.confirmedMinutes !== null;
  const needsReview = day.status === 'NEEDS_REVIEW';
  const shift = day.shiftName ?? t('attendance.shiftNotAssigned');
  const clock = (value: string) =>
    new Date(value).toLocaleTimeString(uiLocale(), {
      timeZone: day.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${day.workDate} ${shift}`}
      accessibilityHint={t('attendance.dayDetail')}
      onPress={onPress}
      style={({ pressed }) => [styles.day, pressed && styles.pressed]}
    >
      <View style={styles.dayHeading}>
        <View style={styles.dayCopy}>
          <Text style={styles.date}>
            {new Intl.DateTimeFormat(uiLocale(), {
              weekday: 'short',
              day: '2-digit',
              month: '2-digit',
              timeZone: 'UTC',
            }).format(new Date(`${day.workDate}T00:00:00Z`))}
          </Text>
          <Text style={styles.shift}>{shift}</Text>
          {day.startsAt && day.endsAt && (
            <Text style={styles.caption}>
              {clock(day.startsAt)} – {clock(day.endsAt)}
            </Text>
          )}
        </View>
        <View style={styles.dayTotal}>
          <Text style={styles.hours}>
            {minutes(day.confirmedMinutes ?? day.provisionalMinutes)}
          </Text>
          <Text style={styles.label}>
            {t(confirmed ? 'attendance.confirmedHours' : 'attendance.provisionalHours')}
          </Text>
          <View style={[styles.status, needsReview && styles.reviewStatus]}>
            <Text style={[styles.statusText, needsReview && styles.reviewText]}>
              {localizedLabel(day.status)}
            </Text>
          </View>
        </View>
        <IconChevronRight size={16} color={colors.textMuted} />
      </View>
      <AttendanceNotices day={day} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copy: { gap: 2, flexShrink: 1 },
  totals: { flexDirection: 'row', gap: 12 },
  metric: { flex: 1, minWidth: 0, gap: 3 },
  title: { fontSize: 14, lineHeight: 21, fontWeight: '700', color: colors.textPrimary },
  caption: { fontSize: 11, lineHeight: 17, color: colors.textMuted },
  label: { fontSize: 11, lineHeight: 17, color: colors.textSecondary },
  total: { fontSize: 26, lineHeight: 34, fontWeight: '700', color: colors.textPrimary },
  estimateValue: { fontSize: 23, lineHeight: 34, fontWeight: '600', color: colors.textSecondary },
  dayCounts: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 10,
  },
  count: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingHorizontal: 4 },
  countDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  countValue: { fontSize: 17, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  countLabel: { fontSize: 11, lineHeight: 17, color: colors.textMuted, textAlign: 'center' },
  day: {
    backgroundColor: colors.surface,
    minHeight: 88,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 5,
  },
  pressed: { opacity: 0.65 },
  dayHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dayCopy: { flex: 1, minWidth: 0, gap: 2 },
  date: { fontSize: 13, lineHeight: 20, fontWeight: '700', color: colors.textPrimary },
  shift: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
  dayTotal: { maxWidth: '48%', alignItems: 'flex-end', gap: 2 },
  hours: { fontSize: 17, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  status: {
    maxWidth: '100%',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: colors.surfaceSubtle,
  },
  statusText: { fontSize: 11, lineHeight: 16, fontWeight: '600', color: colors.textSecondary },
  reviewStatus: { backgroundColor: colors.warningLightBg },
  reviewText: { color: colors.warningText },
});
