import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { colors } from '../../theme/colors';
import { IconQrCode } from '../common/Icons';

interface WorkerQrModalProps {
  visible: boolean;
  workerName?: string;
  workerCode?: string;
  siteName?: string;
  onClose: () => void;
}

export function WorkerQrModal({
  visible,
  workerName = 'Nguyễn Văn An',
  workerCode = 'WS-2026-8891',
  siteName = 'Công trường Riverside',
  onClose,
}: WorkerQrModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(60);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 1 ? prev - 1 : 60));
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Mã QR Dự Phòng</Text>
              <Text style={styles.subtitle}>Sử dụng khi nhận diện khuôn mặt không khả dụng</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* QR visual container */}
          <View style={styles.qrWrapper}>
            <View style={styles.qrBox}>
              {/* Pattern simulation */}
              <View style={styles.qrRow}>
                <View style={styles.qrCorner}><View style={styles.qrCornerInner} /></View>
                <View style={styles.qrDotGrid} />
                <View style={styles.qrCorner}><View style={styles.qrCornerInner} /></View>
              </View>
              <View style={styles.qrCenterGraphic}>
                <View style={styles.qrCenterLogo}>
                  <IconQrCode size={38} color={colors.primary} />
                </View>
              </View>
              <View style={styles.qrRow}>
                <View style={styles.qrCorner}><View style={styles.qrCornerInner} /></View>
                <View style={styles.qrDotGrid} />
                <View style={styles.qrCornerSmall} />
              </View>
            </View>

            <View style={styles.countdownBadge}>
              <Text style={styles.countdownText}>Tự động làm mới sau {secondsLeft}s</Text>
            </View>
          </View>

          {/* Worker Info */}
          <View style={styles.workerInfo}>
            <Text style={styles.name}>{workerName}</Text>
            <Text style={styles.detail}>Mã CN: {workerCode} · {siteName}</Text>
          </View>

          {/* Security notice */}
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Bảo vệ tại cổng sẽ đối chiếu thông tin cá nhân và thẻ nhà thầu trước khi xác nhận vào/ra.
            </Text>
          </View>

          <Pressable style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Đóng</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '100%',
    maxWidth: 380,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  closeText: {
    fontSize: 20,
    color: colors.textMuted,
    fontWeight: '600',
  },
  qrWrapper: {
    alignItems: 'center',
    marginVertical: 10,
  },
  qrBox: {
    width: 200,
    height: 200,
    backgroundColor: '#FAFAFA',
    borderWidth: 2,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    padding: 16,
    justifyContent: 'space-between',
  },
  qrRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  qrCorner: {
    width: 44,
    height: 44,
    borderWidth: 4,
    borderColor: '#1E293B',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCornerInner: {
    width: 18,
    height: 18,
    backgroundColor: '#1E293B',
    borderRadius: 3,
  },
  qrCornerSmall: {
    width: 44,
    height: 44,
    backgroundColor: '#1E293B',
    borderRadius: 8,
  },
  qrDotGrid: {
    width: 50,
    height: 24,
    borderStyle: 'dashed',
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    borderRadius: 4,
  },
  qrCenterGraphic: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
  },
  qrCenterLogo: {
    padding: 6,
    backgroundColor: '#FFF4EE',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  countdownBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginTop: 14,
  },
  countdownText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  workerInfo: {
    alignItems: 'center',
    marginTop: 16,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  detail: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 3,
  },
  notice: {
    backgroundColor: colors.warningLightBg,
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 12,
    marginTop: 16,
    width: '100%',
  },
  noticeText: {
    fontSize: 12,
    color: colors.warningText,
    lineHeight: 17,
    textAlign: 'center',
  },
  doneBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
    marginTop: 20,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
