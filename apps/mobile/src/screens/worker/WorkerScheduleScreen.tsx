import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { colors } from '../../theme/colors';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import {
  IconBriefcase,
  IconClock,
  IconCalendar,
  IconChevronRight,
  IconChevronLeft,
  IconSwap,
} from '../../components/common/Icons';

interface WorkerScheduleScreenProps {
  onNavigateToRequest: (type?: 'swap') => void;
  onSelectShift?: (shiftId: string) => void;
}

interface DayItem {
  dayName: string;
  date: number;
  hasShift: boolean;
  isOff?: boolean;
}

const WEEK_DAYS: DayItem[] = [
  { dayName: 'T2', date: 12, hasShift: true },
  { dayName: 'T3', date: 13, hasShift: true },
  { dayName: 'T4', date: 14, hasShift: true },
  { dayName: 'T5', date: 15, hasShift: true },
  { dayName: 'T6', date: 16, hasShift: true },
  { dayName: 'T7', date: 17, hasShift: true },
  { dayName: 'CN', date: 18, hasShift: false, isOff: true },
];

export function WorkerScheduleScreen({
  onNavigateToRequest,
  onSelectShift,
}: WorkerScheduleScreenProps) {
  const [selectedDate, setSelectedDate] = useState<number>(16);

  return (
    <View style={styles.container}>
      <ScreenHeader
        mode="root"
        tagline="Kết nối con người, xây dựng tương lai"
        hasUnreadNotifications={true}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title & subtitle */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Lịch làm việc</Text>
          <Text style={styles.subtitle}>Quản lý ca làm việc của bạn</Text>
        </View>

        {/* Week Selector Box */}
        <View style={styles.weekCard}>
          {/* Week range navigation header */}
          <View style={styles.weekHeader}>
            <Pressable hitSlop={10} style={styles.arrowBtn}>
              <IconChevronLeft size={18} color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.weekRangeText}>12/10 – 18/10/2026</Text>
            <Pressable hitSlop={10} style={styles.arrowBtn}>
              <IconChevronRight size={18} color={colors.textPrimary} />
            </Pressable>
          </View>

          {/* Days bar */}
          <View style={styles.daysRow}>
            {WEEK_DAYS.map((day) => {
              const isSelected = day.date === selectedDate;
              return (
                <Pressable
                  key={day.date}
                  onPress={() => setSelectedDate(day.date)}
                  style={[styles.dayCol, isSelected && styles.dayColSelected]}
                >
                  <Text style={[styles.dayName, isSelected && styles.dayNameSelected]}>
                    {day.dayName}
                  </Text>
                  <Text style={[styles.dayDate, isSelected && styles.dayDateSelected]}>
                    {day.date}
                  </Text>

                  {/* Indicator dot or status */}
                  {isSelected ? (
                    <View style={styles.selectedDotsRow}>
                      <View style={styles.selectedWhiteDot} />
                      <View style={styles.selectedGreenDot} />
                    </View>
                  ) : day.isOff ? (
                    <Text style={styles.dayOffText}>Nghỉ</Text>
                  ) : day.hasShift ? (
                    <View style={styles.dayDot} />
                  ) : (
                    <View style={{ height: 6 }} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Shifts Group: Thứ Sáu, 16/10 */}
        <View style={styles.groupSection}>
          <Text style={styles.groupHeader}>Thứ Sáu, 16/10</Text>

          {/* Shift 1: Ca hành chính */}
          <Pressable
            style={({ pressed }) => [styles.shiftItem, pressed && { opacity: 0.9 }]}
            onPress={() => onSelectShift?.('shift-1')}
          >
            <View style={[styles.iconBox, { backgroundColor: '#FFF4EE' }]}>
              <IconBriefcase size={22} color={colors.primary} />
            </View>
            <View style={styles.shiftDetails}>
              <Text style={styles.shiftType}>Ca hành chính</Text>
              <Text style={styles.shiftTime}>08:00 – 17:00</Text>
              <Text style={styles.shiftLocation}>📍 Công trường Riverside</Text>
            </View>
            <IconChevronRight size={20} color={colors.textTertiary} />
          </Pressable>

          {/* Shift 2: Tăng ca đã duyệt */}
          <Pressable
            style={({ pressed }) => [styles.shiftItem, pressed && { opacity: 0.9 }]}
            onPress={() => onSelectShift?.('shift-2')}
          >
            <View style={[styles.iconBox, { backgroundColor: '#EDFAF2' }]}>
              <IconClock size={22} color={colors.success} />
            </View>
            <View style={styles.shiftDetails}>
              <View style={styles.overtimeBadge}>
                <Text style={styles.overtimeBadgeText}>Tăng ca đã duyệt</Text>
              </View>
              <Text style={styles.shiftTime}>17:30 – 19:30</Text>
              <Text style={styles.shiftLocation}>📍 Công trường Riverside</Text>
            </View>
            <IconChevronRight size={20} color={colors.textTertiary} />
          </Pressable>
        </View>

        {/* Shifts Group: Thứ Bảy, 17/10 */}
        <View style={styles.groupSection}>
          <Text style={styles.groupHeader}>Thứ Bảy, 17/10</Text>

          <Pressable
            style={({ pressed }) => [styles.shiftItem, pressed && { opacity: 0.9 }]}
            onPress={() => onSelectShift?.('shift-3')}
          >
            <View style={[styles.iconBox, { backgroundColor: '#FFF4EE' }]}>
              <IconBriefcase size={22} color={colors.primary} />
            </View>
            <View style={styles.shiftDetails}>
              <Text style={styles.shiftType}>Ca hành chính</Text>
              <Text style={styles.shiftTime}>08:00 – 12:00</Text>
              <Text style={styles.shiftLocation}>📍 Công trường Riverside</Text>
            </View>
            <IconChevronRight size={20} color={colors.textTertiary} />
          </Pressable>
        </View>

        {/* Shifts Group: Chủ Nhật, 18/10 */}
        <View style={styles.groupSection}>
          <Text style={styles.groupHeader}>Chủ Nhật, 18/10</Text>

          <View style={styles.shiftItemDisabled}>
            <View style={[styles.iconBox, { backgroundColor: '#F3F4F6' }]}>
              <IconCalendar size={22} color={colors.textTertiary} />
            </View>
            <View style={styles.shiftDetails}>
              <Text style={[styles.shiftType, { color: colors.textSecondary }]}>Ngày nghỉ</Text>
              <Text style={styles.shiftLocation}>Không có ca làm việc</Text>
            </View>
          </View>
        </View>

        {/* Bottom Action Button: Đề nghị đổi ca */}
        <Pressable
          style={({ pressed }) => [styles.swapButton, pressed && { opacity: 0.85 }]}
          onPress={() => onNavigateToRequest('swap')}
        >
          <IconSwap size={20} color={colors.primary} />
          <Text style={styles.swapButtonText}>Đề nghị đổi ca</Text>
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
  titleSection: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
  },
  weekCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 20,
  },
  weekHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 14,
  },
  arrowBtn: {
    padding: 4,
  },
  weekRangeText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayCol: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    marginHorizontal: 2,
  },
  dayColSelected: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  dayName: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: 4,
  },
  dayNameSelected: {
    color: '#FFFFFF',
  },
  dayDate: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  dayDateSelected: {
    color: '#FFFFFF',
  },
  dayDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.primary,
  },
  dayOffText: {
    fontSize: 10,
    color: colors.textTertiary,
    fontWeight: '600',
  },
  selectedDotsRow: {
    flexDirection: 'row',
    gap: 3,
  },
  selectedWhiteDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#FFFFFF',
  },
  selectedGreenDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#A7F3D0',
  },
  groupSection: {
    marginBottom: 18,
  },
  groupHeader: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 10,
  },
  shiftItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FB',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 10,
  },
  shiftItemDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    marginBottom: 10,
    opacity: 0.8,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  shiftDetails: {
    flex: 1,
  },
  shiftType: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: 2,
  },
  shiftTime: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0B1B33',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  shiftLocation: {
    fontSize: 12,
    color: colors.textMuted,
  },
  overtimeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginBottom: 4,
  },
  overtimeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  swapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    marginTop: 10,
  },
  swapButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
  },
});
