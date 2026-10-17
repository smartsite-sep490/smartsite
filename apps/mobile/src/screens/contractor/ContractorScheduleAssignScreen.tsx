import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { colors } from '../../theme/colors';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import {
  IconChevronDown,
  IconCalendar,
  IconClock,
  IconUsers,
  IconLock,
} from '../../components/common/Icons';

interface ContractorScheduleAssignScreenProps {
  onBack?: () => void;
  onSuccess?: () => void;
}

const DAYS_OF_WEEK = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export function ContractorScheduleAssignScreen({
  onBack,
  onSuccess,
}: ContractorScheduleAssignScreenProps) {
  const [assignMode, setAssignMode] = useState<'team' | 'worker'>('team');
  const [selectedTeam] = useState('Thi công 01 · 8 công nhân');
  const [selectedShift] = useState('Ca hành chính · 08:00 – 17:00');
  const [fromDate, setFromDate] = useState('19/10/2026');
  const [toDate, setToDate] = useState('31/10/2026');
  const [selectedDays, setSelectedDays] = useState<string[]>(['T2', 'T3', 'T4', 'T5', 'T6', 'T7']);

  const toggleDay = (day: string) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter((d) => d !== day));
    } else {
      setSelectedDays([...selectedDays, day]);
    }
  };

  const handleConfirm = () => {
    Alert.alert(
      'Phân lịch thành công',
      `Đã áp dụng ${selectedShift} cho ${selectedTeam} từ ${fromDate} đến ${toDate} (96 lượt ca).`,
      [
        {
          text: 'Xác nhận',
          onPress: () => {
            onSuccess?.();
            onBack?.();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader mode="detail" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Phân lịch làm việc</Text>

        {/* Top Toggle: [Theo đội] | [Theo công nhân] */}
        <View style={styles.toggleBar}>
          <Pressable
            style={[styles.toggleBtn, assignMode === 'team' && styles.toggleBtnActive]}
            onPress={() => setAssignMode('team')}
          >
            <Text
              style={[
                styles.toggleBtnText,
                assignMode === 'team' && styles.toggleBtnTextActive,
              ]}
            >
              Theo đội
            </Text>
          </Pressable>

          <Pressable
            style={[styles.toggleBtn, assignMode === 'worker' && styles.toggleBtnActive]}
            onPress={() => setAssignMode('worker')}
          >
            <Text
              style={[
                styles.toggleBtnText,
                assignMode === 'worker' && styles.toggleBtnTextActive,
              ]}
            >
              Theo công nhân
            </Text>
          </Pressable>
        </View>

        {/* Field: Đội */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Đội</Text>
          <View style={styles.selectBox}>
            <View style={styles.selectBoxLeft}>
              <IconUsers size={20} color={colors.textMuted} />
              <Text style={styles.selectBoxText}>{selectedTeam}</Text>
            </View>
            <IconChevronDown size={18} color={colors.textMuted} />
          </View>
        </View>

        {/* Field: Ca có sẵn */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Ca có sẵn</Text>
          <View style={styles.selectBox}>
            <View style={styles.selectBoxLeft}>
              <IconClock size={20} color={colors.textMuted} />
              <Text style={styles.selectBoxText}>{selectedShift}</Text>
            </View>
            <IconChevronDown size={18} color={colors.textMuted} />
          </View>
        </View>

        {/* Field: Date Range (Từ - Đến) */}
        <View style={styles.dateRangeRow}>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Từ</Text>
            <View style={styles.dateBox}>
              <IconCalendar size={18} color={colors.textMuted} />
              <TextInput
                style={styles.dateInput}
                value={fromDate}
                onChangeText={setFromDate}
                placeholder="DD/MM/YYYY"
              />
            </View>
          </View>

          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Đến</Text>
            <View style={styles.dateBox}>
              <IconCalendar size={18} color={colors.textMuted} />
              <TextInput
                style={styles.dateInput}
                value={toDate}
                onChangeText={setToDate}
                placeholder="DD/MM/YYYY"
              />
            </View>
          </View>
        </View>

        {/* Field: Các ngày trong tuần */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Các ngày trong tuần</Text>
          <View style={styles.daysCirclesRow}>
            {DAYS_OF_WEEK.map((day) => {
              const isActive = selectedDays.includes(day);
              return (
                <Pressable
                  key={day}
                  onPress={() => toggleDay(day)}
                  style={[styles.dayCircle, isActive && styles.dayCircleActive]}
                >
                  <Text style={[styles.dayCircleText, isActive && styles.dayCircleTextActive]}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Info banner with Lock */}
        <View style={styles.policyNotice}>
          <IconLock size={16} color={colors.textMuted} />
          <Text style={styles.policyNoticeText}>
            Chính sách ca do Site Manager quản lý
          </Text>
        </View>

        {/* Card: Xem trước (8 công nhân | 12 ngày | 96 lượt ca) */}
        <View style={styles.previewCard}>
          <Text style={styles.previewTitle}>Xem trước</Text>
          <View style={styles.previewGrid}>
            <View style={styles.previewCol}>
              <IconUsers size={20} color={colors.textMuted} />
              <Text style={styles.previewValue}>8</Text>
              <Text style={styles.previewLabel}>công nhân</Text>
            </View>

            <View style={styles.previewDivider} />

            <View style={styles.previewCol}>
              <IconCalendar size={20} color={colors.textMuted} />
              <Text style={styles.previewValue}>12</Text>
              <Text style={styles.previewLabel}>ngày</Text>
            </View>

            <View style={styles.previewDivider} />

            <View style={styles.previewCol}>
              <Text style={styles.previewIconText}>≣</Text>
              <Text style={styles.previewValue}>96</Text>
              <Text style={styles.previewLabel}>lượt ca</Text>
            </View>
          </View>
        </View>

        {/* Bottom Button: Xác nhận phân lịch */}
        <Pressable
          style={({ pressed }) => [styles.confirmBtn, pressed && { opacity: 0.88 }]}
          onPress={handleConfirm}
        >
          <Text style={styles.confirmBtnText}>Xác nhận phân lịch</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 16,
  },
  toggleBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F4F8',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  toggleBtnActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  toggleBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  toggleBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 8,
  },
  selectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFAFB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  selectBoxLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  selectBoxText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F1E36',
  },
  dateRangeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  dateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 8,
  },
  dateInput: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#0F1E36',
    padding: 0,
  },
  daysCirclesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  dayCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F1F4F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleActive: {
    backgroundColor: colors.primary,
  },
  dayCircleText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  dayCircleTextActive: {
    color: '#FFFFFF',
  },
  policyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 20,
    marginTop: 4,
  },
  policyNoticeText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  previewCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    padding: 16,
    marginBottom: 24,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 12,
  },
  previewGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  previewCol: {
    alignItems: 'center',
    flex: 1,
  },
  previewIconText: {
    fontSize: 18,
    color: colors.textMuted,
  },
  previewValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
    marginTop: 4,
    marginBottom: 2,
  },
  previewLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  previewDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#E2E8F0',
  },
  confirmBtn: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
