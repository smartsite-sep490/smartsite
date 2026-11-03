import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput } from 'react-native';
import { useTranslation } from '../../i18n';
import { IconCalendar, IconChevronLeft, IconChevronRight } from '../../components/common/Icons';

export interface DateRange {
  fromDate: string;
  toDate: string;
}

interface DateRangeFilterProps {
  range: DateRange;
  onChange: (range: DateRange) => void;
  onValidate?: (range: DateRange) => void;
}

type PresetKey = 'today' | 'last7' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1);
}

function formatDisplayDate(s: string): string {
  const parts = s.split('-');
  if (parts.length < 3) return s;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function computePresets(): Record<Exclude<PresetKey, 'custom'>, DateRange> {
  const now = new Date();
  const todayStr = formatDate(now);

  // 7 days
  const past7 = new Date(now);
  past7.setDate(past7.getDate() - 6);

  // This week (Monday to Sunday)
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(monday.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  // This month
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Last month
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  return {
    today: { fromDate: todayStr, toDate: todayStr },
    last7: { fromDate: formatDate(past7), toDate: todayStr },
    thisWeek: { fromDate: formatDate(monday), toDate: formatDate(sunday) },
    thisMonth: { fromDate: formatDate(monthStart), toDate: todayStr },
    lastMonth: { fromDate: formatDate(lastMonthStart), toDate: formatDate(lastMonthEnd) },
  };
}

export function shiftRange(range: DateRange, direction: -1 | 1): DateRange {
  const from = parseLocalDate(range.fromDate);
  const to = parseLocalDate(range.toDate);
  const diffDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);

  // Month shift if starting on 1st and spanning whole month
  if (from.getDate() === 1 && diffDays >= 28 && diffDays <= 31) {
    const nextFrom = new Date(from.getFullYear(), from.getMonth() + direction, 1);
    const nextTo = new Date(nextFrom.getFullYear(), nextFrom.getMonth() + 1, 0);
    return { fromDate: formatDate(nextFrom), toDate: formatDate(nextTo) };
  }

  const nextFrom = new Date(from);
  nextFrom.setDate(nextFrom.getDate() + diffDays * direction);
  const nextTo = new Date(to);
  nextTo.setDate(nextTo.getDate() + diffDays * direction);
  return { fromDate: formatDate(nextFrom), toDate: formatDate(nextTo) };
}

export function DateRangeFilter({ range, onChange, onValidate }: DateRangeFilterProps) {
  const { t } = useTranslation();
  const [showCustom, setShowCustom] = useState(false);
  const [customFrom, setCustomFrom] = useState(range.fromDate);
  const [customTo, setCustomTo] = useState(range.toDate);
  const [customError, setCustomError] = useState<string | null>(null);

  const presets = computePresets();

  const activeKey: PresetKey = (function () {
    if (showCustom) return 'custom';
    if (range.fromDate === presets.today.fromDate && range.toDate === presets.today.toDate)
      return 'today';
    if (range.fromDate === presets.last7.fromDate && range.toDate === presets.last7.toDate)
      return 'last7';
    if (range.fromDate === presets.thisWeek.fromDate && range.toDate === presets.thisWeek.toDate)
      return 'thisWeek';
    if (range.fromDate === presets.thisMonth.fromDate && range.toDate === presets.thisMonth.toDate)
      return 'thisMonth';
    if (range.fromDate === presets.lastMonth.fromDate && range.toDate === presets.lastMonth.toDate)
      return 'lastMonth';
    return 'custom';
  })();

  const handleSelectPreset = (key: PresetKey) => {
    if (key === 'custom') {
      setShowCustom(true);
      setCustomFrom(range.fromDate);
      setCustomTo(range.toDate);
      setCustomError(null);
      return;
    }
    setShowCustom(false);
    setCustomError(null);
    const nextRange = presets[key];
    onValidate?.(nextRange);
    onChange(nextRange);
  };

  const handleShift = (direction: -1 | 1) => {
    const nextRange = shiftRange(range, direction);
    onValidate?.(nextRange);
    onChange(nextRange);
  };

  const handleApplyCustom = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
      setCustomError('YYYY-MM-DD');
      return;
    }
    if (customFrom > customTo) {
      setCustomError('YYYY-MM-DD');
      return;
    }
    setCustomError(null);
    const nextRange = { fromDate: customFrom, toDate: customTo };
    onValidate?.(nextRange);
    onChange(nextRange);
  };

  const presetOptions: { key: PresetKey; label: string }[] = [
    { key: 'today', label: t('attendance.today') },
    { key: 'last7', label: t('attendance.last7Days') },
    { key: 'thisWeek', label: t('attendance.thisWeek') },
    { key: 'thisMonth', label: t('attendance.thisMonth') },
    { key: 'lastMonth', label: t('attendance.lastMonth') },
    { key: 'custom', label: t('attendance.customRange') },
  ];

  return (
    <View style={styles.container}>
      {/* Horizontally swipeable / draggable preset chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.presetsList}
      >
        {presetOptions.map((item) => {
          const isSelected = activeKey === item.key;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={[styles.presetChip, isSelected && styles.presetChipActive]}
              onPress={() => handleSelectPreset(item.key)}
            >
              <Text style={[styles.presetText, isSelected && styles.presetTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Compact period stepper and date display */}
      <View style={styles.stepperBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.previous')}
          style={({ pressed }) => [styles.arrowBtn, pressed && { opacity: 0.6 }]}
          onPress={() => handleShift(-1)}
        >
          <IconChevronLeft size={22} color="#0F1E36" />
        </Pressable>

        <View style={styles.centerDateRange}>
          <IconCalendar size={18} color="#F66B17" />
          <Text style={styles.dateRangeText}>
            {formatDisplayDate(range.fromDate)}
            {range.fromDate !== range.toDate ? ` – ${formatDisplayDate(range.toDate)}` : ''}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.next')}
          style={({ pressed }) => [styles.arrowBtn, pressed && { opacity: 0.6 }]}
          onPress={() => handleShift(1)}
        >
          <IconChevronRight size={22} color="#0F1E36" />
        </Pressable>
      </View>

      {/* Expandable custom range inputs when custom preset is selected */}
      {showCustom && (
        <View style={styles.customBox}>
          <View style={styles.customRow}>
            <View style={styles.customField}>
              <Text style={styles.customLabel}>{t('attendance.filterFrom')}</Text>
              <TextInput
                style={styles.customInput}
                value={customFrom}
                onChangeText={setCustomFrom}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
              />
            </View>
            <View style={styles.customField}>
              <Text style={styles.customLabel}>{t('attendance.filterTo')}</Text>
              <TextInput
                style={styles.customInput}
                value={customTo}
                onChangeText={setCustomTo}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
              />
            </View>
          </View>
          {customError ? <Text style={styles.errorText}>{customError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('attendance.filter')}
            style={styles.applyBtn}
            onPress={handleApplyCustom}
          >
            <Text style={styles.applyBtnText}>{t('attendance.filter')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  presetsList: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  presetChip: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 38,
    justifyContent: 'center',
    alignItems: 'center',
  },
  presetChipActive: {
    backgroundColor: '#F66B17',
    borderColor: '#F66B17',
    shadowColor: '#F66B17',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  presetText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  presetTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  stepperBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    gap: 8,
  },
  arrowBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexShrink: 0,
  },
  centerDateRange: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  dateRangeText: {
    maxWidth: '100%',
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.2,
    flexShrink: 1,
    textAlign: 'center',
    lineHeight: 22,
  },
  customBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  customRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  customField: {
    flex: 1,
    gap: 4,
    minWidth: 140,
    flexBasis: 140,
  },
  customLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  customInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F1E36',
  },
  applyBtn: {
    backgroundColor: '#F66B17',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  applyBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 21,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '600',
  },
});
