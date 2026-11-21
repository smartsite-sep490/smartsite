import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { IconChevronRight } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { uiLocale, useTranslation } from '../../i18n';

export function ManagementPeriod({ from, to }: { from: string; to: string | null }) {
  const { t } = useTranslation();
  const format = (value: string | null) =>
    value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat(uiLocale(), {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(value))
      : t('common.notRecorded');
  return (
    <View style={styles.period}>
      {[
        [t('access.validFrom'), format(from)],
        [t('access.validUntil'), format(to)],
      ].map(([label, value]) => (
        <View key={label} style={styles.periodItem}>
          <Text style={styles.hint}>{label}</Text>
          <Text style={styles.periodValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

export function ManagementTabs({
  value,
  items,
  onChange,
}: {
  value: string;
  items: { value: string; label: string; accessibilityLabel?: string; count?: number }[];
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.tabs}
    >
      {items.map((item) => (
        <Pressable
          key={item.value}
          accessibilityRole="tab"
          accessibilityLabel={item.accessibilityLabel ?? item.label}
          accessibilityState={{ selected: value === item.value }}
          onPress={() => onChange(item.value)}
          style={[styles.tab, value === item.value && styles.selectedTab]}
        >
          <Text style={[styles.tabText, value === item.value && styles.selectedTabText]}>
            {item.label}
          </Text>
          {item.count !== undefined && (
            <Text style={[styles.count, value === item.value && styles.selectedCount]}>
              {item.count}
            </Text>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function ManagementAction({
  label,
  icon,
  onPress,
  danger = false,
  disabled = false,
  hint,
}: {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, (pressed || disabled) && styles.dim]}
    >
      {icon && <View style={[styles.actionIcon, danger && styles.dangerIcon]}>{icon}</View>}
      <View style={styles.copy}>
        <Text style={[styles.actionLabel, danger && styles.dangerText]}>{label}</Text>
        {hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
      <IconChevronRight size={16} color={danger ? colors.danger : colors.textTertiary} />
    </Pressable>
  );
}
export function ManagementBadge({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <View style={[styles.badge, styles[`${tone}Bg`]]}>
      <Text style={[styles.badgeText, styles[`${tone}Text`]]}>{label}</Text>
    </View>
  );
}
export function ManagementLink({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.link, (pressed || disabled) && styles.dim]}
    >
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}
export function ManagementSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  period: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  periodItem: { flex: 1, minWidth: 100, gap: 4 },
  periodValue: { color: colors.textPrimary, fontSize: 12, lineHeight: 20, fontWeight: '500' },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexGrow: 1,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  selectedTab: { borderBottomColor: colors.primary },
  tabText: { fontSize: 13, lineHeight: 20, color: colors.textMuted, fontWeight: '600' },
  selectedTabText: { color: colors.primary },
  count: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 7,
    overflow: 'hidden',
    fontSize: 10,
    color: colors.textMuted,
    backgroundColor: '#EDEFF2',
  },
  selectedCount: { backgroundColor: colors.primaryLight, color: colors.primary },
  action: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F5F8',
  },
  dangerIcon: { backgroundColor: '#FFF1F1' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  actionLabel: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.textPrimary },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  dim: { opacity: 0.5 },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  badgeText: { fontSize: 10, lineHeight: 16, fontWeight: '700' },
  neutralBg: { backgroundColor: '#EDF0F4' },
  neutralText: { color: '#64748B' },
  successBg: { backgroundColor: '#EAF7F0' },
  successText: { color: '#177249' },
  warningBg: { backgroundColor: '#FFF4DC' },
  warningText: { color: '#946322' },
  dangerBg: { backgroundColor: '#FDEFEF' },
  dangerText: { color: '#B33939' },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, flexShrink: 0 },
  linkText: { color: colors.primary, fontSize: 12, lineHeight: 19, fontWeight: '700' },
  section: { gap: 10 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
