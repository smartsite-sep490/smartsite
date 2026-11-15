import { useContext, useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { uiLocale, useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { Button } from './ui';
import { InlinePickerContext } from './inline-picker-context';

export const PICKER_ROW_HEIGHT = 44;
type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};
type DatePart = 'year' | 'month' | 'day' | 'hour' | 'minute';

function dateParts(value: Date, utc: boolean): DateParts {
  return {
    year: utc ? value.getUTCFullYear() : value.getFullYear(),
    month: (utc ? value.getUTCMonth() : value.getMonth()) + 1,
    day: utc ? value.getUTCDate() : value.getDate(),
    hour: utc ? value.getUTCHours() : value.getHours(),
    minute: utc ? value.getUTCMinutes() : value.getMinutes(),
    second: utc ? value.getUTCSeconds() : value.getSeconds(),
    millisecond: utc ? value.getUTCMilliseconds() : value.getMilliseconds(),
  };
}

function selectedDate(parts: DateParts, utc: boolean): Date {
  const { year, month, day, hour, minute, second, millisecond } = parts;
  return utc
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond))
    : new Date(year, month - 1, day, hour, minute, second, millisecond);
}

export function changeDatePart(parts: DateParts, part: DatePart, value: number): DateParts {
  const next = { ...parts, [part]: value };
  const lastDay = new Date(Date.UTC(next.year, next.month, 0)).getUTCDate();
  return { ...next, day: Math.min(next.day, lastDay) };
}

function Wheel({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  const index = Math.max(0, values.indexOf(value));
  const [initialIndex] = useState(index);
  const { t } = useTranslation();
  useEffect(() => {
    if (Math.round(offset.current / PICKER_ROW_HEIGHT) !== index) {
      offset.current = index * PICKER_ROW_HEIGHT;
      ref.current?.scrollTo({ y: offset.current, animated: false });
    }
  }, [index]);
  const select = (next: number) => {
    const bounded = Math.max(0, Math.min(values.length - 1, next));
    offset.current = bounded * PICKER_ROW_HEIGHT;
    ref.current?.scrollTo({ y: offset.current, animated: false });
    onChange(values[bounded]!);
  };
  return (
    <View style={styles.column}>
      <Text style={styles.columnLabel}>{label}</Text>
      <View
        style={styles.wheel}
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: values[0], max: values.at(-1), now: value, text: String(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          select(index + (event.nativeEvent.actionName === 'increment' ? 1 : -1))
        }
      >
        <View pointerEvents="none" style={styles.selection} />
        <ScrollView
          ref={ref}
          style={styles.wheelScroll}
          nestedScrollEnabled
          bounces={false}
          removeClippedSubviews={false}
          contentInsetAdjustmentBehavior="never"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          accessibilityLabel={label}
          snapToInterval={PICKER_ROW_HEIGHT}
          decelerationRate="fast"
          contentOffset={{ x: 0, y: initialIndex * PICKER_ROW_HEIGHT }}
          contentContainerStyle={styles.wheelContent}
          scrollEventThrottle={16}
          onScroll={(event) => {
            offset.current = event.nativeEvent.contentOffset.y;
            const nearest = Math.max(
              0,
              Math.min(values.length - 1, Math.round(offset.current / PICKER_ROW_HEIGHT)),
            );
            if (values[nearest] !== value) onChange(values[nearest]!);
          }}
        >
          {values.map((item, row) => (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityLabel={t('datePicker.chooseValue', { label, value: item })}
              accessibilityState={{ selected: item === value }}
              onPress={() => select(row)}
              style={styles.row}
            >
              <Text style={[styles.rowText, item === value && styles.selectedText]}>
                {String(item).padStart(2, '0')}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/** Keep the spinner inside the form, with a readable draft and explicit confirmation. */
export function ScrollDateTimePicker({
  value,
  mode,
  utc = false,
  onConfirm,
  onCancel,
}: {
  value: Date;
  mode: 'date' | 'time';
  utc?: boolean;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const reportPicker = useContext(InlinePickerContext);
  useEffect(() => {
    reportPicker(true);
    return () => reportPicker(false);
  }, [reportPicker]);
  const [parts, setParts] = useState<DateParts>(() => dateParts(value, utc));
  const draft = selectedDate(parts, utc);
  const preview =
    mode === 'date'
      ? draft.toLocaleDateString(uiLocale(), {
          ...(utc ? { timeZone: 'UTC' } : {}),
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      : draft.toLocaleTimeString(uiLocale(), {
          ...(utc ? { timeZone: 'UTC' } : {}),
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
  const [yearLimit] = useState(() =>
    Math.max(new Date().getFullYear() + 20, value.getFullYear() + 1),
  );
  const range = (start: number, length: number) =>
    Array.from({ length }, (_, index) => start + index);
  const wheel = (part: DatePart, values: number[]) => (
    <Wheel
      key={part}
      label={t(`datePicker.${part}`)}
      values={values}
      value={parts[part]}
      onChange={(next) => setParts((current) => changeDatePart(current, part, next))}
    />
  );
  return (
    <View style={styles.picker}>
      <Text style={styles.hint}>{t('datePicker.scrollHint')}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.preview}>
        {t('datePicker.selectedValue', { value: preview })}
      </Text>
      {Platform.OS === 'ios' ? (
        <View style={styles.nativeFrame}>
          <DateTimePicker
            value={draft}
            mode={mode}
            display="spinner"
            themeVariant="light"
            textColor={colors.textPrimary}
            accentColor={colors.primary}
            locale={uiLocale()}
            is24Hour
            timeZoneName={utc ? 'UTC' : undefined}
            style={styles.nativePicker}
            onChange={(event, date) => {
              if (event.type !== 'set' || !date || !Number.isFinite(+date)) return;
              const picked = dateParts(date, utc);
              setParts((current) =>
                mode === 'date'
                  ? { ...current, year: picked.year, month: picked.month, day: picked.day }
                  : { ...current, hour: picked.hour, minute: picked.minute },
              );
            }}
          />
        </View>
      ) : (
        <View style={styles.columns}>
          {mode === 'date' ? (
            <>
              {wheel('day', range(1, new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate()))}
              {wheel('month', range(1, 12))}
              {wheel(
                'year',
                range(Math.min(1900, parts.year), yearLimit - Math.min(1900, parts.year) + 1),
              )}
            </>
          ) : (
            <>
              {wheel('hour', range(0, 24))}
              {wheel('minute', range(0, 60))}
            </>
          )}
        </View>
      )}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button secondary label={t('common.cancel')} onPress={onCancel} />
        </View>
        <View style={styles.action}>
          <Button label={t('common.done')} onPress={() => onConfirm(draft)} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    padding: 12,
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  hint: { fontSize: 12, lineHeight: 19, textAlign: 'center', color: colors.textMuted },
  preview: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.textPrimary,
  },
  nativeFrame: {
    height: 216,
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  nativePicker: { height: 216, width: '100%', backgroundColor: '#FFFFFF' },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  column: { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 6 },
  columnLabel: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  wheel: { height: PICKER_ROW_HEIGHT * 5, overflow: 'hidden' },
  wheelScroll: { height: PICKER_ROW_HEIGHT * 5, flexGrow: 0, flexShrink: 0 },
  wheelContent: { paddingVertical: PICKER_ROW_HEIGHT * 2 },
  row: { height: PICKER_ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  rowText: { fontSize: 15, lineHeight: 23, color: colors.textMuted },
  selectedText: { fontSize: 19, lineHeight: 27, color: colors.primaryHover, fontWeight: '700' },
  selection: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PICKER_ROW_HEIGHT * 2,
    height: PICKER_ROW_HEIGHT,
    borderRadius: 8,
    backgroundColor: colors.primaryLight,
  },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1 },
});
