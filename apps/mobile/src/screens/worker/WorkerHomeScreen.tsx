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
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import {
  IconQrCode,
  IconPlus,
  IconAlert,
  IconChevronRight,
} from '../../components/common/Icons';
import { WorkerQrModal } from '../../components/worker/WorkerQrModal';

interface WorkerHomeScreenProps {
  onNavigateToSchedule: () => void;
  onNavigateToAttendance: () => void;
  onNavigateToRequest: () => void;
  onNotificationPress?: () => void;
}

export function WorkerHomeScreen({
  onNavigateToSchedule,
  onNavigateToAttendance,
  onNavigateToRequest,
  onNotificationPress,
}: WorkerHomeScreenProps) {
  const [showQrModal, setShowQrModal] = useState(false);

  return (
    <View style={styles.container}>
      {/* SmartSite Header */}
      <ScreenHeader
        mode="root"
        tagline="Kết nối con người, xây dựng tương lai"
        onNotificationPress={onNotificationPress}
        hasUnreadNotifications={true}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Greeting & Avatar */}
        <View style={styles.greetingSection}>
          <View style={styles.greetingTextContainer}>
            <Text style={styles.greetingSub}>Xin chào,</Text>
            <Text style={styles.workerName}>Nguyễn Văn An</Text>
            <Text style={styles.siteInfo}>Công trường Riverside · 16/10/2026</Text>
          </View>
          <WorkerAvatar size={58} role="worker" />
        </View>

        {/* Card: Ca hôm nay */}
        <Pressable
          style={({ pressed }) => [styles.shiftCard, pressed && { opacity: 0.95 }]}
          onPress={onNavigateToSchedule}
        >
          <Text style={styles.shiftCardTitle}>Ca hôm nay</Text>
          <Text style={styles.shiftHours}>08:00 – 17:00</Text>
          <Text style={styles.shiftBreak}>Nghỉ trưa 12:00 – 13:00</Text>

          {/* Status badge */}
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Đang trong công trường</Text>
          </View>
        </Pressable>

        {/* 2-Column Stats Grid */}
        <View style={styles.statsRow}>
          {/* Card: Giờ làm */}
          <Pressable
            style={({ pressed }) => [styles.statCard, pressed && { opacity: 0.9 }]}
            onPress={onNavigateToAttendance}
          >
            <Text style={styles.statLabel}>Giờ làm</Text>
            <Text style={styles.statValue}>4 giờ 30 phút</Text>
            <View style={styles.temporaryBadge}>
              <Text style={styles.temporaryBadgeText}>Tạm tính</Text>
            </View>
          </Pressable>

          {/* Card: Lượt ra ngoài */}
          <Pressable
            style={({ pressed }) => [styles.statCard, pressed && { opacity: 0.9 }]}
            onPress={onNavigateToAttendance}
          >
            <Text style={styles.statLabel}>Lượt ra ngoài</Text>
            <Text style={styles.statValue}>1/2</Text>
            <View style={{ height: 24 }} />
          </Pressable>
        </View>

        {/* Quick Actions (2 Buttons) */}
        <View style={styles.actionButtonsRow}>
          {/* Orange Filled Button: QR dự phòng */}
          <Pressable
            style={({ pressed }) => [styles.primaryActionBtn, pressed && { opacity: 0.88 }]}
            onPress={() => setShowQrModal(true)}
          >
            <IconQrCode size={20} color="#FFFFFF" />
            <Text style={styles.primaryActionBtnText}>QR dự phòng</Text>
          </Pressable>

          {/* White Bordered Button: Gửi yêu cầu */}
          <Pressable
            style={({ pressed }) => [styles.secondaryActionBtn, pressed && { opacity: 0.85 }]}
            onPress={onNavigateToRequest}
          >
            <IconPlus size={20} color={colors.textPrimary} />
            <Text style={styles.secondaryActionBtnText}>Gửi yêu cầu</Text>
          </Pressable>
        </View>

        {/* Notice Card: Ca ngày 17/10 đã được cập nhật */}
        <Pressable
          style={({ pressed }) => [styles.noticeCard, pressed && { opacity: 0.9 }]}
          onPress={onNavigateToSchedule}
        >
          <View style={styles.noticeLeft}>
            <IconAlert size={20} color={colors.warning} />
            <Text style={styles.noticeText}>Ca ngày 17/10 đã được cập nhật</Text>
          </View>
          <IconChevronRight size={20} color={colors.textMuted} />
        </Pressable>
      </ScrollView>

      {/* Emergency QR Modal */}
      <WorkerQrModal
        visible={showQrModal}
        workerName="Nguyễn Văn An"
        workerCode="WS-2026-8891"
        siteName="Công trường Riverside"
        onClose={() => setShowQrModal(false)}
      />
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
    paddingBottom: 28,
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
  greetingSub: {
    fontSize: 14,
    color: colors.textMuted,
    fontWeight: '400',
    marginBottom: 2,
  },
  workerName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  siteInfo: {
    fontSize: 13,
    color: colors.textMuted,
  },
  shiftCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 16,
  },
  shiftCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  shiftHours: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0B1B33',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  shiftBreak: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 16,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 7,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.successText,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#F8F9FB',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    justifyContent: 'space-between',
  },
  statLabel: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: 6,
  },
  statValue: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0B1B33',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  temporaryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  temporaryBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B45309',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  primaryActionBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
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
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
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
  noticeCard: {
    backgroundColor: '#FEF9ED',
    borderWidth: 1,
    borderColor: '#FDECC8',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  noticeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  noticeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#92400E',
    flex: 1,
  },
});
