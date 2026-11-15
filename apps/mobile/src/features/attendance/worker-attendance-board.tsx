import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AttendanceDayResponse, AttendanceSummaryResponse } from '@smartsite/api-client';
import { useTranslation, uiLocale } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { IconChevronRight } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { minutes } from '../shared/data';

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
      <View style={styles.copy}>
        <Text style={styles.label}>{t('attendance.confirmedHours')}</Text>
        <Text style={styles.total}>{minutes(summary.totalMinutes)}</Text>
        <Text style={styles.caption}>
          {t('attendance.includesOvertime', { hours: minutes(summary.overtimeMinutes) })}
        </Text>
      </View>
      <View style={styles.estimate}>
        <Text style={styles.label}>{t('attendance.provisionalHours')}</Text>
        <Text style={styles.estimateValue}>{minutes(summary.provisionalMinutes)}</Text>
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
  const [now, setNow] = useState(Date.now);
  const hasPendingLeave = day.anomalies.includes('PENDING_LEAVE');
  useEffect(() => {
    if (!hasPendingLeave) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [hasPendingLeave]);
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
  const anomalies = day.anomalies.filter(
    (anomaly) => anomaly !== 'PENDING_REQUEST' || !day.anomalies.includes('PENDING_LEAVE'),
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${day.workDate} ${shift}`}
      accessibilityHint={t('attendance.dayDetail')}
      onPress={onPress}
      style={({ pressed }) => [styles.day, pressed && styles.pressed]}
    >
      <View style={styles.dayHeading}>
        <Text style={styles.date}>
          {new Intl.DateTimeFormat(uiLocale(), {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            timeZone: 'UTC',
          }).format(new Date(`${day.workDate}T00:00:00Z`))}
        </Text>
        <IconChevronRight size={18} color={colors.textMuted} />
      </View>
      <Text style={styles.shift}>{shift}</Text>
      {day.startsAt && day.endsAt && (
        <Text style={styles.caption}>
          {t('attendanceUi.scheduleHours')} {clock(day.startsAt)} – {clock(day.endsAt)}
        </Text>
      )}
      <View style={styles.dayTotal}>
        <View style={styles.copy}>
          <Text style={styles.label}>
            {t(confirmed ? 'attendance.confirmedHours' : 'attendance.provisionalHours')}
          </Text>
          <Text style={styles.hours}>
            {minutes(day.confirmedMinutes ?? day.provisionalMinutes)}
          </Text>
        </View>
        <View style={[styles.status, needsReview && styles.reviewStatus]}>
          <Text style={[styles.statusText, needsReview && styles.reviewText]}>
            {localizedLabel(day.status)}
          </Text>
        </View>
      </View>
      {anomalies.length > 0 && (
        <View style={styles.notice}>
          {anomalies.map((anomaly) => (
            <Text key={anomaly} style={styles.noticeText}>
              {anomaly === 'PENDING_LEAVE'
                ? t(
                    day.presence === 'OUTSIDE' &&
                      day.provisionalMinutes === 0 &&
                      day.endsAt &&
                      Date.parse(day.endsAt) <= now
                      ? 'leavePolicy.absentPendingLeave'
                      : 'leavePolicy.pendingLeave',
                  )
                : localizedLabel(anomaly)}
            </Text>
          ))}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
    gap: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copy: { gap: 4, flexShrink: 1 },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '700', color: colors.textPrimary },
  caption: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  label: { fontSize: 12, lineHeight: 19, color: colors.textSecondary },
  total: { fontSize: 34, lineHeight: 44, fontWeight: '800', color: colors.textPrimary },
  estimate: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle,
  },
  estimateValue: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.textSecondary },
  dayCounts: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 16,
  },
  count: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  countDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  countValue: { fontSize: 21, lineHeight: 28, fontWeight: '700', color: colors.textPrimary },
  countLabel: { fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center' },
  day: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 6,
  },
  pressed: { opacity: 0.65 },
  dayHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  date: { flex: 1, fontSize: 14, lineHeight: 22, fontWeight: '700', color: colors.textPrimary },
  shift: { fontSize: 13, lineHeight: 21, color: colors.textSecondary },
  dayTotal: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    marginTop: 6,
    paddingTop: 12,
  },
  hours: { fontSize: 20, lineHeight: 28, fontWeight: '700', color: colors.textPrimary },
  status: {
    maxWidth: '100%',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: colors.surfaceSubtle,
  },
  statusText: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: colors.textSecondary },
  reviewStatus: { backgroundColor: colors.warningLightBg },
  reviewText: { color: colors.warningText },
  notice: {
    borderRadius: 8,
    padding: 10,
    gap: 4,
    marginTop: 6,
    backgroundColor: colors.warningLightBg,
  },
  noticeText: { fontSize: 12, lineHeight: 19, color: colors.warningText },
});
