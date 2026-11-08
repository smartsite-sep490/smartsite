import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconChevronLeft, IconChevronRight } from '../../components/common/Icons';
import { useTranslation, uiLocale } from '../../i18n';
import { colors } from '../../theme/colors';
import { Button } from './ui';

type MonthYearPickerProps = {
  visible: boolean;
  value: string;
  onChange: (year: number, month: number) => void;
  onClose: () => void;
};

export function MonthYearPicker(props: MonthYearPickerProps) {
  return props.visible ? <MonthYearPickerContent {...props} /> : null;
}

function MonthYearPickerContent({ value, onChange, onClose }: MonthYearPickerProps) {
  const { t } = useTranslation();
  const selectedYear = Number(value.slice(0, 4));
  const selectedMonth = Number(value.slice(5, 7)) - 1;
  const [year, setYear] = useState(selectedYear);
  const formatMonth = (month: number, short = false) =>
    new Intl.DateTimeFormat(uiLocale(), {
      month: short ? 'short' : 'long',
      ...(short ? {} : { year: 'numeric' as const }),
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month, 1)));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
        />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.yearRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('schedule.previousYear')}
              onPress={() => setYear(year - 1)}
              style={styles.arrow}
            >
              <IconChevronLeft size={20} />
            </Pressable>
            <Text style={styles.year}>{year}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('schedule.nextYear')}
              onPress={() => setYear(year + 1)}
              style={styles.arrow}
            >
              <IconChevronRight size={20} />
            </Pressable>
          </View>
          <View style={styles.grid}>
            {Array.from({ length: 12 }, (_, month) => {
              const active = selectedYear === year && selectedMonth === month;
              return (
                <Pressable
                  key={month}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={formatMonth(month)}
                  onPress={() => {
                    onChange(year, month);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.month,
                    active && styles.selectedMonth,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.monthText, active && styles.selectedText]}>
                    {formatMonth(month, true)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Button secondary label={t('common.close')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: 20,
    gap: 20,
  },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  year: { color: colors.textPrimary, fontSize: 23, fontWeight: '800' },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  month: {
    width: '30%',
    flexGrow: 1,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  monthText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  selectedMonth: { backgroundColor: colors.primary },
  selectedText: { color: '#FFFFFF' },
  pressed: { opacity: 0.65 },
});
