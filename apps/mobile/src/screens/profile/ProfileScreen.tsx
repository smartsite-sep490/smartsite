import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { colors } from '../../theme/colors';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import {
  IconCheck,
  IconChevronRight,
  IconShield,
  IconLock,
} from '../../components/common/Icons';

interface ProfileScreenProps {
  role: 'worker' | 'contractor';
  onSwitchRole: (newRole: 'worker' | 'contractor') => void;
  onLogout: () => void;
}

export function ProfileScreen({
  role,
  onSwitchRole,
  onLogout,
}: ProfileScreenProps) {
  const isWorker = role === 'worker';
  const name = isWorker ? 'Nguyễn Văn An' : 'Trần Quốc Bảo';
  const roleTitle = isWorker ? 'Công nhân Xây dựng' : 'Đại diện Nhà thầu An Phong';
  const code = isWorker ? 'WS-2026-8891' : 'CR-2026-0042';

  return (
    <View style={styles.container}>
      <ScreenHeader
        mode="root"
        tagline="Thông tin tài khoản & thiết lập"
        hasUnreadNotifications={false}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* User Card */}
        <View style={styles.profileCard}>
          <WorkerAvatar size={68} role={role} />
          <Text style={styles.profileName}>{name}</Text>
          <Text style={styles.profileRole}>{roleTitle}</Text>
          <Text style={styles.profileSite}>
            Mã: {code} · Công trường Riverside
          </Text>

          {/* Biometric verification badge */}
          <View style={styles.biometricBadge}>
            <IconCheck size={14} color={colors.success} />
            <Text style={styles.biometricBadgeText}>
              Đã kích hoạt nhận diện khuôn mặt AI
            </Text>
          </View>
        </View>

        {/* Quick Role Switcher for paired testing */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Chế độ giao diện (Demo)</Text>
          <View style={styles.switchBox}>
            <Pressable
              style={[styles.switchOption, isWorker && styles.switchOptionActive]}
              onPress={() => onSwitchRole('worker')}
            >
              <Text
                style={[
                  styles.switchOptionText,
                  isWorker && styles.switchOptionTextActive,
                ]}
              >
                Công nhân (Worker)
              </Text>
            </Pressable>
            <Pressable
              style={[styles.switchOption, !isWorker && styles.switchOptionActive]}
              onPress={() => onSwitchRole('contractor')}
            >
              <Text
                style={[
                  styles.switchOptionText,
                  !isWorker && styles.switchOptionTextActive,
                ]}
              >
                Nhà thầu (Contractor)
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Settings list */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cài đặt & An toàn</Text>

          <Pressable
            style={styles.settingItem}
            onPress={() =>
              Alert.alert(
                'Khu vực được cấp phép',
                isWorker
                  ? 'Bạn được cấp quyền vào Zone B (Tầng 1-3) thuộc ca hành chính.'
                  : 'Bạn có quyền quản lý toàn bộ các Zone do Nhà thầu An Phong thi công.',
              )
            }
          >
            <View style={styles.settingLeft}>
              <IconShield size={20} color={colors.primary} />
              <Text style={styles.settingText}>Phân quyền khu vực (Zone Access)</Text>
            </View>
            <IconChevronRight size={18} color={colors.textTertiary} />
          </Pressable>

          <Pressable
            style={styles.settingItem}
            onPress={() =>
              Alert.alert('Đổi mật khẩu', 'Liên hệ ban quản lý công trường để cấp lại mã pin / mật khẩu.')
            }
          >
            <View style={styles.settingLeft}>
              <IconLock size={20} color={colors.textPrimary} />
              <Text style={styles.settingText}>Đổi mật khẩu tài khoản</Text>
            </View>
            <IconChevronRight size={18} color={colors.textTertiary} />
          </Pressable>
        </View>

        {/* Logout Button */}
        <Pressable
          style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.85 }]}
          onPress={onLogout}
        >
          <Text style={styles.logoutBtnText}>Đăng xuất</Text>
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
    paddingBottom: 36,
  },
  profileCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 20,
  },
  profileName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginTop: 12,
    marginBottom: 4,
  },
  profileRole: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileSite: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 16,
  },
  biometricBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 6,
  },
  biometricBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.successText,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 10,
  },
  switchBox: {
    flexDirection: 'row',
    backgroundColor: '#F1F4F8',
    borderRadius: 14,
    padding: 4,
  },
  switchOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
  },
  switchOptionActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  switchOptionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  switchOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8F9FB',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 10,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  settingText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  logoutBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  logoutBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
});
