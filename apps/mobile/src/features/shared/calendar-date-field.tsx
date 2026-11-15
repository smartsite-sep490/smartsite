import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconCalendar } from '../../components/common/Icons';
import { uiLocale, useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { ScrollDateTimePicker } from './scroll-date-time-picker';

/** Keep calendar dates independent of the device's UTC offset. */
export function CalendarDateField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const parsed = new Date(`${value}T00:00:00Z`);
  const selected = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.chooseDate', { label })}
        accessibilityValue={{ text: value || t('common.notSelected') }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.control, pressed && { opacity: 0.65 }]}
      >
        <IconCalendar size={18} color={colors.textMuted} />
        <Text style={styles.value}>
          {value
            ? selected.toLocaleDateString(uiLocale(), {
                timeZone: 'UTC',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })
            : t('common.notSelected')}
        </Text>
      </Pressable>
      {open && (
        <ScrollDateTimePicker
          utc
          value={selected}
          mode="date"
          onCancel={() => setOpen(false)}
          onConfirm={(date) => {
            onChange(date.toISOString().slice(0, 10));
            setOpen(false);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: colors.textSecondary },
  control: {
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  value: { flex: 1, fontSize: 14, lineHeight: 22, fontWeight: '600', color: colors.textPrimary },
});
