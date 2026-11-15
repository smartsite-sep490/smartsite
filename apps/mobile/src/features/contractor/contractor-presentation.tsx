import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconChevronRight } from '../../components/common/Icons';
import { colors } from '../../theme/colors';

export function ListHeading({ title, count }: { title: string; count?: string }) {
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {count && <Text style={styles.count}>{count}</Text>}
    </View>
  );
}

export function Metrics({
  items,
}: {
  items: { label: string; value: number; attention?: boolean }[];
}) {
  return (
    <View style={styles.metrics}>
      {items.map((item, index) => (
        <View key={item.label} style={[styles.metric, index > 0 && styles.divider]}>
          <Text style={[styles.value, item.attention && item.value > 0 && styles.attention]}>
            {item.value}
          </Text>
          <Text style={styles.label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <View style={styles.empty}>
      {icon && <View style={styles.emptyIcon}>{icon}</View>}
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint && <Text style={styles.emptyHint}>{hint}</Text>}
    </View>
  );
}

export function DetailLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.65 }]}
    >
      <Text style={styles.linkText}>{label}</Text>
      <IconChevronRight size={17} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 6,
  },
  title: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  count: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  metrics: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
    paddingVertical: 18,
  },
  metric: { flex: 1, minWidth: 0, paddingHorizontal: 10, alignItems: 'center', gap: 5 },
  divider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  value: { fontSize: 24, lineHeight: 32, fontWeight: '700', color: colors.textPrimary },
  attention: { color: colors.warningText },
  label: { fontSize: 12, lineHeight: 19, textAlign: 'center', color: colors.textMuted },
  empty: {
    padding: 24,
    gap: 10,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: { padding: 14, borderRadius: 18, backgroundColor: colors.primaryLight },
  emptyTitle: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyHint: { fontSize: 12, lineHeight: 20, color: colors.textMuted, textAlign: 'center' },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 8,
  },
  linkText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.primaryHover,
  },
});
