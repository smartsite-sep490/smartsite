import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import { colors } from '../../theme/colors';
import {
  IconChevronLeft,
  IconPencil,
  IconUser,
  IconClock,
  IconChevronRight,
  IconPause,
} from '../../components/common/Icons';

interface ContractorWorkerDetailScreenProps {
  onBack: () => void;
  workerName?: string;
  workerCode?: string;
  team?: string;
}

export function ContractorWorkerDetailScreen({
  onBack,
  workerName = 'Nguyễn Văn An',
  workerCode = 'W000123',
  team = 'Đội Thi công 01',
}: ContractorWorkerDetailScreenProps) {
  const [isSuspended, setIsSuspended] = useState(false);

  const handleToggleSuspend = () => {
    Alert.alert(
      isSuspended ? 'Khôi phục công nhân' : 'Xác nhận tạm ngưng',
      isSuspended
        ? `Khôi phục trạng thái hoạt động cho ${workerName}? Khôi phục không tự cấp lại quyền vào cổng nếu chưa được duyệt.`
        : `Tạm ngưng công nhân ${workerName}? Công nhân sẽ bị thu hồi quyền vào cổng tạm thời.`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: isSuspended ? 'Khôi phục' : 'Tạm ngưng',
          style: isSuspended ? 'default' : 'destructive',
          onPress: () => setIsSuspended(!isSuspended),
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header with Back & Edit Pencil */}
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <IconChevronLeft size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Hồ sơ công nhân</Text>
        <Pressable
          hitSlop={10}
          style={styles.editBtn}
          onPress={() => Alert.alert('Chỉnh sửa', 'Mở form chỉnh sửa thông tin công nhân')}
        >
          <IconPencil size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Worker Avatar & Identity */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>NA</Text>
          </View>
          <Text style={styles.workerName}>{workerName}</Text>
          <Text style={styles.workerSub}>
            {workerCode} · {team}
          </Text>

          {/* Status Badge */}
          <View
            style={[
              styles.statusPill,
              isSuspended
                ? { backgroundColor: '#F1F5F9' }
                : { backgroundColor: '#EDFAF2' },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                isSuspended
                  ? { backgroundColor: '#64748B' }
                  : { backgroundColor: colors.success },
              ]}
            />
            <Text
              style={[
                styles.statusText,
                isSuspended
                  ? { color: colors.textSecondary }
                  : { color: colors.successText },
              ]}
            >
              {isSuspended ? 'Tạm ngưng hoạt động' : 'Đang hoạt động'}
            </Text>
          </View>
        </View>

        {/* Section 1: Account & Assigned Shift Card */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <IconUser size={20} color={colors.textMuted} />
            <View style={styles.infoCol}>
              <Text style={styles.infoLabel}>Tài khoản liên kết</Text>
              <Text style={styles.infoVal}>an.nguyen</Text>
            </View>
          </View>

          <View style={styles.cardDivider} />

          <View style={styles.infoRow}>
            <IconClock size={20} color={colors.textMuted} />
            <View style={styles.infoCol}>
              <Text style={styles.infoLabel}>Ca được phân</Text>
              <Text style={styles.infoValBold}>Ca hành chính</Text>
              <Text style={styles.infoSub}>08:00 – 17:00, T2 – T7</Text>
            </View>
          </View>
        </View>

        {/* Section 2: Recent Attendance */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardHeaderLeft}>
              <IconClock size={18} color={colors.textPrimary} />
              <Text style={styles.cardHeading}>Chấm công gần đây</Text>
            </View>
            <IconChevronRight size={18} color={colors.textTertiary} />
          </View>

          {/* Attendance Log Row 1 */}
          <View style={styles.attendanceRow}>
            <Text style={styles.attDate}>15/10</Text>
            <Text style={styles.attHours}>7g 50p</Text>
            <View style={[styles.attBadge, { backgroundColor: '#EDFAF2' }]}>
              <View style={[styles.statusDotSmall, { backgroundColor: colors.success }]} />
              <Text style={[styles.attBadgeText, { color: colors.successText }]}>Đã xác nhận</Text>
            </View>
          </View>

          {/* Attendance Log Row 2 */}
          <View style={styles.attendanceRow}>
            <Text style={styles.attDate}>14/10</Text>
            <Text style={styles.attHours}>7g 20p</Text>
            <View style={[styles.attBadge, { backgroundColor: '#FEF3C7' }]}>
              <View style={[styles.statusDotSmall, { backgroundColor: colors.warning }]} />
              <Text style={[styles.attBadgeText, { color: '#B45309' }]}>Cần đối soát</Text>
            </View>
          </View>

          {/* Attendance Log Row 3 */}
          <View style={styles.attendanceRow}>
            <Text style={styles.attDate}>13/10</Text>
            <Text style={styles.attHours}>8g</Text>
            <View style={[styles.attBadge, { backgroundColor: '#EDFAF2' }]}>
              <View style={[styles.statusDotSmall, { backgroundColor: colors.success }]} />
              <Text style={[styles.attBadgeText, { color: colors.successText }]}>Đã xác nhận</Text>
            </View>
          </View>
        </View>

        {/* Section 3: Face Registration */}
        <View style={styles.card}>
          <View style={styles.faceHeader}>
            <Text style={styles.faceHeaderIcon}>⛶</Text>
            <Text style={styles.cardHeading}>Đăng ký khuôn mặt</Text>
          </View>

          <View style={styles.faceCenter}>
            <View style={styles.faceScanBox}>
              <Text style={styles.faceBracketTopLeft}>⌜</Text>
              <Text style={styles.faceBracketTopRight}>⌝</Text>
              <Text style={styles.faceIconSymbol}>☺</Text>
              <Text style={styles.faceBracketBottomLeft}>⌞</Text>
              <Text style={styles.faceBracketBottomRight}>⌟</Text>
            </View>

            <View style={styles.registeredBadge}>
              <View style={[styles.statusDotSmall, { backgroundColor: colors.success }]} />
              <Text style={styles.registeredBadgeText}>Đã đăng ký · 02/10/2026</Text>
            </View>

            <Pressable
              hitSlop={8}
              onPress={() =>
                Alert.alert('Đăng ký lại', 'Mở luồng hướng dẫn đăng ký nhận diện khuôn mặt mới.')
              }
            >
              <Text style={styles.reRegisterLink}>Hướng dẫn đăng ký lại ›</Text>
            </Pressable>
          </View>
        </View>

        {/* Bottom Actions */}
        <View style={styles.bottomButtonsRow}>
          <Pressable
            style={({ pressed }) => [styles.nameEditBtn, pressed && { opacity: 0.85 }]}
            onPress={() => Alert.alert('Chỉnh tên', 'Mở hộp thoại chỉnh sửa họ và tên công nhân')}
          >
            <IconPencil size={18} color={colors.textPrimary} />
            <Text style={styles.nameEditBtnText}>Chỉnh tên</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.suspendBtn, pressed && { opacity: 0.85 }]}
            onPress={handleToggleSuspend}
          >
            <IconPause size={18} color="#DC2626" />
            <Text style={styles.suspendBtnText}>
              {isSuspended ? 'Khôi phục' : 'Tạm ngưng'}
            </Text>
          </Pressable>
        </View>

        {/* Subtext warning */}
        <Text style={styles.recoverNote}>
          ⓘ Khôi phục không tự cấp quyền vào cổng
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F8',
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
  },
  editBtn: {
    padding: 4,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarLarge: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarLargeText: {
    fontSize: 26,
    fontWeight: '900',
    color: '#EA580C',
  },
  workerName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  workerSub: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  infoCol: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  infoVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
  },
  infoValBold: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
  },
  infoSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#EFF2F6',
    marginVertical: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1E36',
  },
  attendanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F4F8',
  },
  attDate: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F1E36',
    width: 60,
  },
  attHours: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
    flex: 1,
  },
  attBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    gap: 5,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  attBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  faceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  faceHeaderIcon: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  faceCenter: {
    alignItems: 'center',
  },
  faceScanBox: {
    width: 80,
    height: 80,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  faceBracketTopLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  faceBracketTopRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  faceBracketBottomLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  faceBracketBottomRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
  },
  faceIconSymbol: {
    fontSize: 32,
    color: '#0F1E36',
  },
  registeredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
    marginBottom: 8,
  },
  registeredBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.successText,
  },
  reRegisterLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  bottomButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 10,
  },
  nameEditBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D8DEE6',
    borderRadius: 14,
    paddingVertical: 14,
  },
  nameEditBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  suspendBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: 14,
    paddingVertical: 14,
  },
  suspendBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
  },
  recoverNote: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textTertiary,
    marginTop: 4,
  },
});
