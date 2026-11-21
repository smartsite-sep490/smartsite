import { StyleSheet, Text, View } from 'react-native';
import type { ShiftResponse } from '@smartsite/api-client';
import { uiLocale, useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { calendarDate, shiftClock, shiftDayOffset } from './schedule-calendar';

/** Planned shift times, shared by the worker and contractor calendar sheets. */
export function ScheduleDaySummary({
  workDate,
  shift,
}: {
  workDate: string;
  shift?: ShiftResponse;
}) {
  const { t } = useTranslation();
  const locale = uiLocale();
  const nextDay = shift ? shiftDayOffset(shift) : 0;
  return (
    <View style={styles.card}>
      <Text style={styles.date}>
        {new Intl.DateTimeFormat(locale, {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC',
        }).format(calendarDate(workDate))}
      </Text>
      <Text accessibilityRole="header" style={styles.name}>
        {shift?.name ?? t('schedule.shiftUnavailable')}
      </Text>
      <View style={styles.times}>
        <View style={styles.time}>
          <Text style={styles.caption}>{t('scheduleDay.starts')}</Text>
          <Text style={styles.clock}>{shift ? shiftClock(shift, 'start') : '—'}</Text>
        </View>
        <View style={styles.time}>
          <Text style={styles.caption}>{t('scheduleDay.ends')}</Text>
          <Text style={styles.clock}>{shift ? shiftClock(shift, 'end') : '—'}</Text>
          {nextDay > 0 && (
            <Text style={styles.nextDay}>{t('schedule.nextDay', { count: nextDay })}</Text>
          )}
        </View>
      </View>
      {shift ? (
        <Text style={styles.caption}>
          {t('attendanceDetail.siteTimezone', { timezone: shift.timezone })}
        </Text>
      ) : (
        <Text style={styles.caption}>{t('schedule.timeUnavailable')}</Text>
      )}
      {shift?.breakStartsAt && shift.breakEndsAt && (
        <View style={styles.breakRow}>
          <Text style={styles.caption}>{t('attendanceDetail.breakTime')}</Text>
          <Text style={styles.breakTime}>
            {new Date(shift.breakStartsAt).toLocaleTimeString(locale, {
              timeZone: shift.timezone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
            {' – '}
            {new Date(shift.breakEndsAt).toLocaleTimeString(locale, {
              timeZone: shift.timezone,
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    gap: 10,
  },
  date: { fontSize: 12, lineHeight: 19, color: colors.textSecondary },
  name: { fontSize: 18, lineHeight: 25, color: colors.textPrimary, fontWeight: '700' },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 4 },
  time: { flexGrow: 1, flexBasis: 100, gap: 3 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19, flexShrink: 1 },
  clock: {
    color: colors.textPrimary,
    fontSize: 29,
    lineHeight: 38,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  nextDay: { color: colors.primaryHover, fontSize: 11, lineHeight: 17, fontWeight: '600' },
  breakRow: {
    borderTopWidth: 1,
    borderColor: colors.primaryBorder,
    paddingTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  breakTime: { fontSize: 12, lineHeight: 19, color: colors.textPrimary, fontWeight: '600' },
});
