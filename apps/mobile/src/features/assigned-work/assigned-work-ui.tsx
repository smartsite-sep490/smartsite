import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { localizedLabel } from '../../i18n/messages';
import { colors } from '../../theme/colors';
import { ManagementBadge } from '../shared/management-ui';

export function WorkStatus({ status }: { status: string }) {
  const tone = ['ACCEPTED', 'VERIFIED', 'CLOSED', 'APPROVED', 'PASS'].includes(status)
    ? 'success'
    : ['RETURNED', 'REJECTED', 'FAIL', 'HIGH', 'CRITICAL'].includes(status)
      ? 'danger'
      : ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'PENDING', 'MEDIUM'].includes(status)
        ? 'warning'
        : 'neutral';
  return <ManagementBadge label={localizedLabel(status)} tone={tone} />;
}

export function WorkSummary({
  title,
  status,
  icon,
  children,
}: PropsWithChildren<{
  title: string;
  status: string;
  icon?: ReactNode;
}>) {
  return (
    <View style={workStyles.card}>
      <View style={workStyles.heading}>
        {icon && <View style={workStyles.icon}>{icon}</View>}
        <Text accessibilityRole="header" style={workStyles.title}>
          {title}
        </Text>
      </View>
      <WorkStatus status={status} />
      {children}
    </View>
  );
}

export function WorkMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={workStyles.meta}>
      <Text style={workStyles.label}>{label}</Text>
      <Text selectable style={workStyles.value}>
        {value}
      </Text>
    </View>
  );
}

export const workStyles = StyleSheet.create({
  context: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  listHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listCount: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 12,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    padding: 15,
    gap: 12,
    minHeight: 44,
  },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  itemMeta: { gap: 7 },
  meta: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  label: { width: 88, fontSize: 12, lineHeight: 20, color: colors.textMuted, flexShrink: 1 },
  value: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 20,
    fontWeight: '500',
  },
  itemFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  link: { flex: 1, color: colors.primary, fontSize: 12, lineHeight: 20, fontWeight: '600' },
  record: {
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  recordTitle: { color: colors.textPrimary, fontSize: 13, lineHeight: 21, fontWeight: '600' },
  recordBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 21 },
  review: { padding: 12, borderRadius: 12, backgroundColor: colors.warningLightBg, gap: 5 },
  reviewText: { fontSize: 12, lineHeight: 20, color: colors.warningText },
  stack: { gap: 12 },
  progressTrack: {
    height: 5,
    backgroundColor: colors.borderLight,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressValue: { height: 5, backgroundColor: colors.primary, borderRadius: 3 },
  criteriaHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  criteriaTitle: { color: colors.textPrimary, fontSize: 15, lineHeight: 23, fontWeight: '700' },
});
