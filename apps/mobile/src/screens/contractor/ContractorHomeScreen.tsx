import React from 'react';
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
  IconDocument,
  IconCalendar,
  IconShield,
  IconChevronRight,
  IconUserPlus,
} from '../../components/common/Icons';

interface ContractorHomeScreenProps {
  onNavigateToRequests: () => void;
  onNavigateToWorkforce: () => void;
  onNavigateToSchedule?: () => void;
  onNavigateToChecklist?: () => void;
  onAddWorker?: () => void;
  onNotificationPress?: () => void;
  onAvatarPress?: () => void;
}

export function ContractorHomeScreen({
  onNavigateToRequests,
  onNavigateToWorkforce,
  onNavigateToSchedule,
  onNavigateToChecklist,
  onAddWorker,
  onNotificationPress,
  onAvatarPress,
}: ContractorHomeScreenProps) {
  return (
    <View style={styles.container}>
      {/* Header */}
      <ScreenHeader
        mode="root"
        showAvatar={true}
        avatarRole="contractor"
        onNotificationPress={onNotificationPress}
        onAvatarPress={onAvatarPress}
        hasUnreadNotifications={true}
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Contractor Greeting Section */}
        <View style={styles.greetingSection}>
          <View style={styles.greetingTextContainer}>
            <Text style={styles.greetingName}>Xin chào, Trần Minh</Text>
            <Text style={styles.companyInfo}>
              Nhà thầu An Phát · Công trường Riverside · 16/10/2026
            </Text>
          </View>
        </View>

        {/* 4 Stats Column Card (Image 3: 24 | 18 | 4 | 2) */}
        <View style={styles.statsCard}>
          <Pressable style={styles.statCol} onPress={onNavigateToWorkforce}>
            <Text style={styles.statValDefault}>24</Text>
            <Text style={styles.statSubLabel}>Công nhân</Text>
          </Pressable>

          <View style={styles.colDivider} />

          <Pressable style={styles.statCol} onPress={onNavigateToWorkforce}>
            <Text style={styles.statValGreen}>18</Text>
            <Text style={styles.statSubLabel}>Trong công trường</Text>
          </Pressable>

          <View style={styles.colDivider} />

          <Pressable style={styles.statCol} onPress={onNavigateToWorkforce}>
            <Text style={styles.statValOrange}>4</Text>
            <Text style={styles.statSubLabel}>Ngoài công trường</Text>
          </Pressable>

          <View style={styles.colDivider} />

          <Pressable style={styles.statCol} onPress={onNavigateToWorkforce}>
            <Text style={styles.statValGray}>2</Text>
            <Text style={styles.statSubLabel}>Chưa vào</Text>
          </Pressable>
        </View>

        {/* Section: Cần xử lý */}
        <View style={styles.actionSectionHeader}>
          <Text style={styles.sectionTitle}>Cần xử lý</Text>
          <Pressable onPress={onNavigateToRequests}>
            <Text style={styles.seeAllText}>Xem tất cả ›</Text>
          </Pressable>
        </View>

        <View style={styles.actionCard}>
          {/* Row 1: Yêu cầu chờ duyệt */}
          <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.9 }]}
            onPress={onNavigateToRequests}
          >
            <View style={[styles.iconSquare, { backgroundColor: '#FFF4EE' }]}>
              <IconDocument size={20} color={colors.primary} />
            </View>
            <Text style={styles.actionRowTitle}>Yêu cầu chờ duyệt</Text>
            <View style={styles.badgeOrange}>
              <Text style={styles.badgeOrangeText}>5</Text>
            </View>
            <IconChevronRight size={18} color={colors.textTertiary} />
          </Pressable>

          <View style={styles.rowDivider} />

          {/* Row 2: Ngày công cần đối soát */}
          <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.9 }]}
            onPress={onNavigateToWorkforce}
          >
            <View style={[styles.iconSquare, { backgroundColor: '#EFF6FF' }]}>
              <IconCalendar size={20} color="#2563EB" />
            </View>
            <Text style={styles.actionRowTitle}>Ngày công cần đối soát</Text>
            <View style={styles.badgeYellow}>
              <Text style={styles.badgeYellowText}>3</Text>
            </View>
            <IconChevronRight size={18} color={colors.textTertiary} />
          </Pressable>

          <View style={styles.rowDivider} />

          {/* Row 3: Checklist an toàn được giao */}
          <Pressable
            style={({ pressed }) => [styles.actionRow, pressed && { opacity: 0.9 }]}
            onPress={onNavigateToChecklist || onNavigateToWorkforce}
          >
            <View style={[styles.iconSquare, { backgroundColor: '#EDFAF2' }]}>
              <IconShield size={20} color={colors.success} />
            </View>
            <Text style={styles.actionRowTitle}>Checklist an toàn được giao</Text>
            <Text style={styles.deadlineText}>Hạn 17:00 hôm nay</Text>
            <IconChevronRight size={18} color={colors.textTertiary} />
          </Pressable>
        </View>

        {/* 2 Big Action Buttons (Image 3) */}
        <View style={styles.actionButtonsRow}>
          {/* Orange Filled Button: Thêm công nhân */}
          <Pressable
            style={({ pressed }) => [styles.primaryActionBtn, pressed && { opacity: 0.88 }]}
            onPress={onAddWorker || onNavigateToWorkforce}
          >
            <IconUserPlus size={20} color="#FFFFFF" />
            <Text style={styles.primaryActionBtnText}>Thêm công nhân</Text>
          </Pressable>

          {/* White Bordered Button: Phân lịch */}
          <Pressable
            style={({ pressed }) => [styles.secondaryActionBtn, pressed && { opacity: 0.85 }]}
            onPress={onNavigateToSchedule}
          >
            <IconCalendar size={20} color={colors.textPrimary} />
            <Text style={styles.secondaryActionBtnText}>Phân lịch</Text>
          </Pressable>
        </View>
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
  greetingSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  greetingTextContainer: {
    flex: 1,
    paddingRight: 12,
  },
  greetingName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  companyInfo: {
    fontSize: 13,
    color: colors.textMuted,
  },
  statsCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 24,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statValDefault: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 4,
  },
  statValGreen: {
    fontSize: 26,
    fontWeight: '800',
    color: '#10B981',
    marginBottom: 4,
  },
  statValOrange: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F97316',
    marginBottom: 4,
  },
  statValGray: {
    fontSize: 26,
    fontWeight: '800',
    color: '#64748B',
    marginBottom: 4,
  },
  statSubLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '500',
    textAlign: 'center',
  },
  colDivider: {
    width: 1,
    backgroundColor: '#EFF2F6',
    marginVertical: 4,
  },
  actionSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
  },
  seeAllText: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '600',
  },
  actionCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  iconSquare: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
  },
  badgeOrange: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOrangeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  badgeYellow: {
    backgroundColor: '#F59E0B',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeYellowText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  deadlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#EF4444',
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#EFF2F6',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#D8DEE6',
  },
  secondaryActionBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
});
