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
import { ScreenHeader } from '../../components/common/ScreenHeader';

interface ContractorRequestDetailScreenProps {
  onBack: () => void;
  onApproveSuccess?: () => void;
  onRejectSuccess?: () => void;
}

export function ContractorRequestDetailScreen({
  onBack,
  onApproveSuccess,
  onRejectSuccess,
}: ContractorRequestDetailScreenProps) {
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = () => {
    Alert.alert('Thành công', 'Đã phê duyệt yêu cầu điều chỉnh công của Nguyễn Văn An.', [
      {
        text: 'Đóng',
        onPress: () => {
          onApproveSuccess?.();
          onBack();
        },
      },
    ]);
  };

  const handleReject = () => {
    if (!rejectReason.trim()) {
      Alert.alert('Thông báo', 'Vui lòng nhập lý do từ chối trước khi xác nhận.');
      return;
    }
    Alert.alert('Đã từ chối', 'Yêu cầu đã bị từ chối với lý do ghi nhận.', [
      {
        text: 'Đóng',
        onPress: () => {
          onRejectSuccess?.();
          onBack();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader mode="detail" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Chi tiết yêu cầu</Text>

        {/* Top Card: Request Info & Before/After Comparison */}
        <View style={styles.mainCard}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.requestTypeTitle}>Điều chỉnh công</Text>
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeIcon}>🕒</Text>
              <Text style={styles.pendingBadgeText}>Chờ duyệt</Text>
            </View>
          </View>

          <Text style={styles.workerMetaText}>Nguyễn Văn An · W000123 · Thi công 01</Text>
          <Text style={styles.shiftDateText}>📅 Ngày 14/10/2026 · Ca 08:00 – 17:00</Text>

          {/* Comparison Side-by-Side Box */}
          <View style={styles.compareContainer}>
            {/* Box 1: Hiện tại */}
            <View style={styles.compareCurrentBox}>
              <Text style={styles.compareBoxLabel}>Hiện tại</Text>
              <Text style={styles.compareValSub}>Vào lại:</Text>
              <Text style={styles.compareValMain}>chưa ghi nhận</Text>
              <Text style={styles.compareHoursLabel}>Giờ thường</Text>
              <Text style={styles.compareHoursBold}>7g 20p</Text>
            </View>

            {/* Arrow */}
            <Text style={styles.arrowSymbol}>→</Text>

            {/* Box 2: Đề nghị */}
            <View style={styles.compareProposedBox}>
              <Text style={styles.compareProposedLabel}>Đề nghị</Text>
              <Text style={styles.compareValSub}>Vào lại:</Text>
              <Text style={styles.compareValMainOrange}>10:05</Text>
              <Text style={styles.compareHoursLabel}>Giờ thường</Text>
              <Text style={styles.compareHoursBold}>7g 50p</Text>
            </View>
          </View>
        </View>

        {/* Card: Lý do */}
        <View style={styles.reasonCard}>
          <Text style={styles.reasonHeader}>Lý do</Text>
          <Text style={styles.reasonText}>
            Quên quét khi vào lại lúc 10:05, có tổ trưởng xác nhận.
          </Text>

          <View style={styles.originalEventNote}>
            <Text style={styles.originalEventText}>
              ⓘ Sự kiện quét gốc được giữ nguyên
            </Text>
          </View>
        </View>

        {/* Bottom Actions Card / Sheet */}
        <View style={styles.actionsSheet}>
          <Text style={styles.rejectInputLabel}>Lý do từ chối (bắt buộc khi từ chối)</Text>
          <TextInput
            style={styles.rejectInput}
            placeholder="Nhập lý do..."
            placeholderTextColor="#94A3B8"
            value={rejectReason}
            onChangeText={setRejectReason}
          />

          <View style={styles.actionButtonsRow}>
            <Pressable
              style={({ pressed }) => [styles.rejectBtn, pressed && { opacity: 0.85 }]}
              onPress={handleReject}
            >
              <Text style={styles.rejectBtnText}>Từ chối</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.approveBtn, pressed && { opacity: 0.88 }]}
              onPress={handleApprove}
            >
              <Text style={styles.approveBtnText}>Phê duyệt</Text>
            </Pressable>
          </View>
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
    paddingBottom: 36,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 16,
  },
  mainCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  requestTypeTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  pendingBadgeIcon: {
    fontSize: 12,
  },
  pendingBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  workerMetaText: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 4,
  },
  shiftDateText: {
    fontSize: 13,
    color: '#0F1E36',
    fontWeight: '600',
    marginBottom: 16,
  },
  compareContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  compareCurrentBox: {
    flex: 1,
    backgroundColor: '#EEF2F6',
    borderRadius: 14,
    padding: 14,
  },
  compareBoxLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 6,
  },
  compareValSub: {
    fontSize: 11,
    color: '#64748B',
  },
  compareValMain: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F1E36',
    marginBottom: 10,
  },
  compareHoursLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  compareHoursBold: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F1E36',
  },
  arrowSymbol: {
    fontSize: 22,
    fontWeight: '700',
    color: '#64748B',
  },
  compareProposedBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#FED7AA',
    borderRadius: 14,
    padding: 14,
  },
  compareProposedLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F05A28',
    marginBottom: 6,
  },
  compareValMainOrange: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 10,
  },
  reasonCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 20,
  },
  reasonHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 6,
  },
  reasonText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 12,
  },
  originalEventNote: {
    backgroundColor: '#EEF2F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  originalEventText: {
    fontSize: 11,
    color: '#64748B',
  },
  actionsSheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  rejectInputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F1E36',
    marginBottom: 8,
  },
  rejectInput: {
    backgroundColor: '#FAFAFB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13,
    color: '#0F1E36',
    marginBottom: 16,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  rejectBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  rejectBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#DC2626',
  },
  approveBtn: {
    flex: 1,
    backgroundColor: '#16A34A',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  approveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
