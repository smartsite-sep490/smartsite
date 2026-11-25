import { useState, type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  AttendanceDayDetailResponse,
  AttendanceOverviewResponse,
  AttendanceSessionResponse,
} from '@smartsite/api-client';
import { uiLocale, useTranslation } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { colors } from '../../theme/colors';
import { IconChevronDown, IconChevronUp } from '../../components/common/Icons';
import { minutes } from '../shared/data';
import { Button, Hint } from '../shared/ui';
import { AttendanceNotices } from './attendance-notices';

function clock(value: string | null | undefined, timezone: string) {
  return value
    ? new Date(value).toLocaleTimeString(uiLocale(), {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
}

export function attendanceFullTime(value: string | null | undefined, timezone: string) {
  return value
    ? new Date(value).toLocaleString(uiLocale(), {
        timeZone: timezone,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
}

function localDay(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  return ['year', 'month', 'day']
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join('-');
}

function StatusBadge({ status }: { status: string }) {
  const tone = ['CONFIRMED', 'APPROVED'].includes(status)
    ? 'success'
    : ['ABSENT', 'REJECTED'].includes(status)
      ? 'danger'
      : ['NEEDS_REVIEW', 'PENDING', 'IN_PROGRESS', 'OPEN'].includes(status)
        ? 'warning'
        : 'neutral';
  return (
    <View style={[styles.badge, styles[`${tone}Bg`]]}>
      <Text style={[styles.badgeText, styles[`${tone}Text`]]}>{localizedLabel(status)}</Text>
    </View>
  );
}

export function AttendanceDisclosure({ title, children }: PropsWithChildren<{ title: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={styles.disclosureButton}
      >
        <Text style={styles.disclosureTitle}>{title}</Text>
        {open ? (
          <IconChevronUp size={18} color={colors.textMuted} />
        ) : (
          <IconChevronDown size={18} color={colors.textMuted} />
        )}
      </Pressable>
      {open && <View style={styles.disclosureContent}>{children}</View>}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function TimePair({
  from,
  to,
  timezone,
  workDate,
  missing = false,
}: {
  from: string | null | undefined;
  to: string | null | undefined;
  timezone: string;
  workDate: string;
  missing?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.timePair}>
      {[
        { label: t('attendance.checkIn'), value: from },
        { label: t('attendance.checkOut'), value: to },
      ].map(({ label, value }) => (
        <View key={label} style={styles.timeCell}>
          <Text style={styles.caption}>{label}</Text>
          <Text style={[styles.clock, !value && styles.mutedClock]}>{clock(value, timezone)}</Text>
          {value && localDay(value, timezone) !== workDate && (
            <Text style={styles.caption}>
              {new Date(value).toLocaleDateString(uiLocale(), {
                timeZone: timezone,
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </Text>
          )}
          {!value && missing && (
            <Text style={styles.caption}>{t('attendanceDetail.notRecorded')}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

export function AttendanceDayView({
  detail: { day, sessions },
  siteName,
  canCorrect,
  onCorrect,
  onIgnore,
}: {
  detail: AttendanceDayDetailResponse;
  siteName: string;
  canCorrect: boolean;
  onCorrect: (session: AttendanceSessionResponse) => void;
  onIgnore?: (session: AttendanceSessionResponse) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.summary}>
        <View style={styles.identity}>
          <Text style={styles.date}>
            {new Intl.DateTimeFormat(uiLocale(), {
              weekday: 'short',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(`${day.workDate}T00:00:00Z`))}
          </Text>
          <View style={styles.nameRow}>
            <Text style={styles.workerName}>{day.workerName}</Text>
            <StatusBadge status={day.status} />
          </View>
          <Text style={styles.caption}>{siteName}</Text>
        </View>
        <View style={styles.hoursOverview}>
          <View style={styles.totalBlock}>
            <Text style={styles.label}>
              {t(
                day.status === 'ABSENT'
                  ? 'attendance.worked'
                  : day.confirmedMinutes !== null
                    ? 'attendance.confirmedHours'
                    : 'attendance.provisionalHours',
              )}
            </Text>
            <Text style={styles.total}>
              {minutes(day.confirmedMinutes ?? day.provisionalMinutes)}
            </Text>
            {day.confirmedMinutes === null && day.status !== 'ABSENT' && (
              <Text style={styles.caption}>{t('attendanceDetail.provisionalHint')}</Text>
            )}
          </View>
          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.caption}>{t('attendance.regularHoursLabel')}</Text>
              <Text style={styles.metricValue}>{minutes(day.regularMinutes)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.caption}>{t('attendance.overtime')}</Text>
              <Text style={styles.metricValue}>{minutes(day.overtimeMinutes)}</Text>
            </View>
          </View>
        </View>
        <View style={styles.shift}>
          <Text style={styles.label}>{day.shiftName ?? t('attendance.shiftNotAssigned')}</Text>
          {(day.startsAt || day.endsAt) && (
            <Text style={styles.shiftTime}>
              {clock(day.startsAt, day.timezone)} – {clock(day.endsAt, day.timezone)}
            </Text>
          )}
          {day.endsAt && localDay(day.endsAt, day.timezone) !== day.workDate && (
            <Text style={styles.caption}>
              {t('attendanceDetail.shiftEndsOn', {
                date: new Date(day.endsAt).toLocaleDateString(uiLocale(), {
                  timeZone: day.timezone,
                }),
              })}
            </Text>
          )}
          <Text style={styles.timezone}>
            {t('attendanceDetail.siteTimezone', { timezone: day.timezone })}
          </Text>
        </View>
      </View>

      <AttendanceNotices key={day.id} day={day} expandable />

      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {t('attendance.timeline')}
        </Text>
        <Text style={styles.caption}>
          {t('attendanceDetail.sessionTotal', { count: sessions.length })}
        </Text>
      </View>
      {!sessions.length && (
        <View style={styles.card}>
          <Hint>{t('attendance.noSessions')}</Hint>
        </View>
      )}
      {sessions.map((s, index) => (
        <View key={s.id} style={styles.card}>
          <View style={styles.sessionHeader}>
            <Text style={styles.sectionTitle}>
              {t('attendance.sessionCount', { index: index + 1 })}
            </Text>
            <StatusBadge status={s.status} />
          </View>
          <TimePair
            from={s.effectiveInAt ?? s.rawInAt}
            to={s.effectiveOutAt ?? s.rawOutAt}
            timezone={day.timezone}
            workDate={day.workDate}
            missing
          />
          <AttendanceDisclosure title={t('attendanceDetail.originalSession', { index: index + 1 })}>
            <DetailRow
              label={t('attendance.checkIn')}
              value={attendanceFullTime(s.rawInAt, day.timezone)}
            />
            <DetailRow
              label={t('attendance.checkOut')}
              value={attendanceFullTime(s.rawOutAt, day.timezone)}
            />
            {s.ignoreReason && <Text style={styles.reason}>{s.ignoreReason}</Text>}
          </AttendanceDisclosure>
          {canCorrect && !['IGNORED', 'IGNORED_DUPLICATE'].includes(s.status) && (
            <Button
              secondary
              label={t('attendance.requestSessionCorrection')}
              onPress={() => onCorrect(s)}
            />
          )}
          {onIgnore && s.canIgnoreDuplicate && (
            <Button
              secondary
              label={t('attendanceReview.ignoreDuplicate')}
              onPress={() => onIgnore(s)}
            />
          )}
        </View>
      ))}

      <View style={styles.card}>
        <AttendanceDisclosure title={t('attendanceDetail.calculationDetails')}>
          <Hint>{t('attendanceDetail.sessionTimeHint')}</Hint>
          <DetailRow
            label={t('workerHome.gateExits')}
            value={day.exitCount === undefined ? '—' : String(day.exitCount)}
          />
          <DetailRow
            label={t('attendanceDetail.deducted')}
            value={day.deductedMinutes === undefined ? '—' : minutes(day.deductedMinutes)}
          />
          {(day.breakStartsAt || day.breakEndsAt) && (
            <DetailRow
              label={t('attendanceDetail.breakTime')}
              value={`${clock(day.breakStartsAt, day.timezone)} – ${clock(day.breakEndsAt, day.timezone)}`}
            />
          )}
          {day.allowedExitMinutes !== undefined && (
            <DetailRow
              label={t('attendanceDetail.allowedExit')}
              value={minutes(day.allowedExitMinutes)}
            />
          )}
          {day.maxExitCount !== undefined && (
            <DetailRow label={t('attendanceDetail.maxExits')} value={String(day.maxExitCount)} />
          )}
        </AttendanceDisclosure>
      </View>
    </>
  );
}

export function AttendanceCorrectionHistory({
  data,
  workDate,
  timezone,
  onReview,
}: {
  data: AttendanceOverviewResponse;
  workDate: string;
  timezone: string;
  onReview?: (correction: AttendanceOverviewResponse['corrections'][number]) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {t('attendance.correctionHistory')}
      </Text>
      {data.hasPendingCorrection && (
        <Text style={styles.pendingNotice}>{t('attendance.pendingCorrectionWarning')}</Text>
      )}
      {!data.corrections.length && <Text style={styles.caption}>{t('attendance.noRequests')}</Text>}
      {data.corrections.map((c, index) => (
        <View key={c.id} style={styles.historyItem}>
          <View style={styles.sessionHeader}>
            <Text style={styles.label}>
              {t('attendanceDetail.correctionNumber', { index: index + 1 })}
            </Text>
            <StatusBadge status={c.status} />
          </View>
          <Text style={styles.caption}>{t('attendanceDetail.proposedTimes')}</Text>
          <TimePair
            from={c.proposedInAt}
            to={c.proposedOutAt}
            timezone={timezone}
            workDate={workDate}
          />
          <Text style={styles.caption}>{t('attendance.correctionReason')}</Text>
          <Text style={styles.reason}>{c.reason}</Text>
          {c.canReview && onReview && (
            <Button
              secondary
              label={t('attendanceReview.reviewCorrection')}
              onPress={() => onReview(c)}
            />
          )}
          {c.reviewNote && (
            <View style={styles.reviewNote}>
              <Text style={styles.caption}>{t('attendanceDetail.reviewNote')}</Text>
              <Text style={styles.reason}>{c.reviewNote}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summary: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  identity: { gap: 4, alignItems: 'flex-start' },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  date: { fontSize: 14, lineHeight: 22, color: colors.textSecondary, fontWeight: '600' },
  workerName: { fontSize: 18, lineHeight: 25, fontWeight: '700', color: colors.textPrimary },
  label: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textSecondary,
    flexShrink: 1,
  },
  caption: { fontSize: 12, lineHeight: 19, color: colors.textMuted, flexShrink: 1 },
  hoursOverview: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  totalBlock: { gap: 3, flexGrow: 1, flexBasis: 110 },
  total: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  metrics: { flexGrow: 1, flexBasis: 120, gap: 8 },
  metric: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    padding: 10,
    gap: 2,
    backgroundColor: colors.surfaceSubtle,
  },
  metricValue: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textPrimary,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  shift: { borderTopWidth: 1, borderColor: colors.borderLight, paddingTop: 10, gap: 3 },
  shiftTime: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.textPrimary,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  timezone: { fontSize: 11, lineHeight: 17, color: colors.textMuted },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '700', flexShrink: 1 },
  successBg: { backgroundColor: colors.successBg },
  successText: { color: colors.successText },
  dangerBg: { backgroundColor: colors.dangerBg },
  dangerText: { color: colors.dangerText },
  warningBg: { backgroundColor: colors.warningBg },
  warningText: { color: colors.warningText },
  neutralBg: { backgroundColor: colors.surfaceSubtle },
  neutralText: { color: colors.textSecondary },
  sectionHeading: { gap: 3, paddingTop: 6, paddingHorizontal: 2 },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  sessionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timePair: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  timeCell: {
    flexGrow: 1,
    flexBasis: 100,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    gap: 4,
  },
  clock: {
    fontSize: 25,
    lineHeight: 33,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  mutedClock: { color: colors.textTertiary },
  detailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 8,
  },
  detailValue: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
    textAlign: 'right',
  },
  disclosure: { borderTopWidth: 1, borderColor: colors.borderLight },
  disclosureButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  disclosureTitle: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.textSecondary,
    fontWeight: '600',
    flex: 1,
  },
  disclosureContent: { gap: 12, paddingTop: 4, paddingBottom: 4 },
  pendingNotice: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.warningText,
    padding: 12,
    backgroundColor: colors.warningLightBg,
    borderRadius: 12,
  },
  historyItem: { borderTopWidth: 1, borderColor: colors.borderLight, paddingTop: 14, gap: 8 },
  reason: { fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  reviewNote: { borderLeftWidth: 2, borderColor: colors.border, paddingLeft: 12, gap: 4 },
});
