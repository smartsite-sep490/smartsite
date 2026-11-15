import { useTranslation } from '../../i18n';
import { translate as tr, uiLocale } from '../../i18n';
import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Button, Hint } from './ui';
import { displayTime } from './data';
import { colors } from '../../theme/colors';
import { IconCalendar, IconClock } from '../../components/common/Icons';
import { ScrollDateTimePicker } from './scroll-date-time-picker';

export function DateTimeField({
  label,
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  useTranslation();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const date = value && Number.isFinite(Date.parse(value)) ? new Date(value) : new Date();
  return (
    <View style={{ gap: 8 }}>
      {compact ? (
        <>
          <Text style={styles.label}>{label}</Text>
          <View style={styles.controls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('common.chooseDate', { label })}
              accessibilityValue={{
                text: value ? date.toLocaleDateString(uiLocale()) : tr('common.notSelected'),
              }}
              disabled={disabled}
              onPress={() => setMode('date')}
              style={({ pressed }) => [styles.control, styles.date, pressed && styles.pressed]}
            >
              <IconCalendar size={17} color={colors.textMuted} />
              <Text style={styles.value}>
                {value
                  ? date.toLocaleDateString(uiLocale(), {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    })
                  : '—'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('common.chooseTime', { label })}
              accessibilityValue={{
                text: value
                  ? date.toLocaleTimeString(uiLocale(), {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : tr('common.notSelected'),
              }}
              disabled={disabled || !value}
              onPress={() => setMode('time')}
              style={({ pressed }) => [
                styles.control,
                pressed && styles.pressed,
                !value && styles.disabled,
              ]}
            >
              <IconClock size={17} color={colors.textMuted} />
              <Text style={styles.value}>
                {value
                  ? date.toLocaleTimeString(uiLocale(), {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : '—'}
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Hint>
            {label}: {value ? displayTime(value) : tr('common.notSelected')}
          </Hint>
          <Button
            secondary
            label={tr('common.chooseDate', { label })}
            disabled={disabled}
            onPress={() => setMode('date')}
          />
          <Button
            secondary
            label={tr('common.chooseTime', { label })}
            disabled={disabled || !value}
            onPress={() => setMode('time')}
          />
        </>
      )}
      {mode && (
        <ScrollDateTimePicker
          value={date}
          mode={mode}
          onCancel={() => setMode(null)}
          onConfirm={(selected) => {
            onChange(selected.toISOString());
            setMode(null);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: colors.textSecondary },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  control: {
    flex: 1,
    minWidth: 96,
    minHeight: 48,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  date: { flexGrow: 1.5, minWidth: 150 },
  value: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.45 },
});
