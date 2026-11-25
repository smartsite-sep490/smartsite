import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AttendanceDayResponse } from '@smartsite/api-client';
import { IconAlert, IconChevronDown, IconChevronUp } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { colors } from '../../theme/colors';

/** The board stays brief; day details retain every unique reason on demand. */
export function AttendanceNotices({
  day,
  expandable = false,
}: {
  day: AttendanceDayResponse;
  expandable?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const pendingLeave = day.anomalies.includes('PENDING_LEAVE');
  useEffect(() => {
    if (!pendingLeave) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [pendingLeave]);
  const reasons = [...new Set(day.anomalies)]
    .filter((code) => code !== 'PENDING_REQUEST' || !pendingLeave)
    .map((code) => ({
      code,
      label:
        code === 'PENDING_LEAVE'
          ? t(
              day.presence === 'OUTSIDE' &&
                day.provisionalMinutes === 0 &&
                day.endsAt &&
                Date.parse(day.endsAt) <= now
                ? 'leavePolicy.absentPendingLeave'
                : 'leavePolicy.pendingLeave',
            )
          : localizedLabel(code),
    }));
  if (!reasons.length) return null;

  const summary = (
    <>
      <IconAlert size={16} color={colors.warningText} />
      <Text style={styles.summary} numberOfLines={2}>
        {reasons[0]!.label}
      </Text>
      {reasons.length > 1 && (
        <Text style={styles.count}>
          {expandable ? String(reasons.length) : `+${reasons.length - 1}`}
        </Text>
      )}
      {expandable &&
        (open ? (
          <IconChevronUp size={16} color={colors.textMuted} />
        ) : (
          <IconChevronDown size={16} color={colors.textMuted} />
        ))}
    </>
  );
  return (
    <View style={styles.container}>
      {expandable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('attendanceDetail.attention')}
          accessibilityHint={t('attendanceDetail.reviewReasons', { count: reasons.length })}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(!open)}
          style={styles.heading}
        >
          {summary}
        </Pressable>
      ) : (
        <View style={styles.preview}>{summary}</View>
      )}
      {expandable && open && (
        <View style={styles.details}>
          {reasons.map(({ code, label }) => (
            <View key={code} style={styles.reason}>
              <View style={styles.dot} />
              <Text style={styles.reasonText}>{label}</Text>
            </View>
          ))}
          <Text style={styles.hint}>{t('attendanceDetail.reviewHint')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.surfaceSubtle, borderRadius: 12 },
  heading: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9 },
  summary: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  count: {
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.warningText,
    backgroundColor: colors.warningLightBg,
    paddingHorizontal: 7,
    borderRadius: 6,
  },
  details: { borderTopWidth: 1, borderColor: colors.borderLight, padding: 12, gap: 8 },
  reason: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.warningText, marginTop: 7 },
  reasonText: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
});
