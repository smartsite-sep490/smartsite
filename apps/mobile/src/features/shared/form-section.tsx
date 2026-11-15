import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';

/** The same field grouping for worker and representative request sheets. */
export function FormSection({
  number,
  title,
  children,
}: PropsWithChildren<{ number?: string; title: string }>) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        {number && <Text style={styles.number}>{number}</Text>}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: 16,
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  number: {
    color: colors.primary,
    backgroundColor: colors.primaryLight,
    borderRadius: 8,
    padding: 7,
    overflow: 'hidden',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '800',
  },
  title: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700', color: colors.textPrimary },
});
