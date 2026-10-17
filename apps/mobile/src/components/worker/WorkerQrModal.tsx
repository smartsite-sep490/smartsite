import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { colors } from '../../theme/colors';
import { useTranslation } from '../../i18n';
import { WorkerQrPanel } from '../../features/workspace/worker-qr-panel';

interface WorkerQrModalProps {
  visible: boolean;
  workerName?: string;
  siteName?: string;
  onClose: () => void;
}

export function WorkerQrModal({ visible, workerName, siteName, onClose }: WorkerQrModalProps) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('qrModal.title')}</Text>
              <Text style={styles.subtitle}>{t('qrModal.subtitle')}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('qrModal.close')}
              onPress={onClose}
              hitSlop={10}
              style={styles.closeBtn}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <View style={styles.workerInfo}>
              {workerName && <Text style={styles.name}>{workerName}</Text>}
              {siteName && <Text style={styles.detail}>{siteName}</Text>}
            </View>
            {visible && <WorkerQrPanel />}
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{t('qrModal.securityNotice')}</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 30, 54, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    maxHeight: '90%',
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '800', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  closeBtn: { padding: 6 },
  closeText: { fontSize: 18, color: colors.textMuted, fontWeight: '700' },
  content: { gap: 12 },
  workerInfo: { alignItems: 'center' },
  name: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
  detail: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  notice: {
    backgroundColor: colors.warningLightBg,
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 10,
    padding: 10,
  },
  noticeText: { fontSize: 11.5, color: colors.warningText, lineHeight: 16, textAlign: 'center' },
});
