import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { colors } from '../../theme/colors';
import { ScreenHeader } from '../../components/common/ScreenHeader';
import { IconQrCode } from '../../components/common/Icons';

interface WorkerQrScreenProps {
  onBack: () => void;
  workerName?: string;
  workerCode?: string;
  siteName?: string;
}

export function WorkerQrScreen({
  onBack,
  workerName = 'Nguyễn Văn An',
  workerCode = 'W000123',
  siteName = 'Công trường Riverside · Cổng chính',
}: WorkerQrScreenProps) {
  const [gateMode, setGateMode] = useState<'in' | 'out'>('in');
  const [sessionCode, setSessionCode] = useState('4827');
  const [secondsRemaining, setSecondsRemaining] = useState(165); // 02:45

  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 1 ? prev - 1 : 180));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleRefresh = () => {
    setSecondsRemaining(180);
    setSessionCode(String(Math.floor(1000 + Math.random() * 9000)));
  };

  const progressPercent = Math.min(100, Math.max(0, (secondsRemaining / 180) * 100));

  return (
    <View style={styles.container}>
      <ScreenHeader mode="detail" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>QR dự phòng</Text>

        {/* Session Code & Refresh */}
        <View style={styles.sessionRow}>
          <Text style={styles.sessionText}>
            Mã phiên: <Text style={styles.sessionCode}>{sessionCode}</Text>
          </Text>
          <Pressable onPress={handleRefresh} hitSlop={8}>
            <Text style={styles.refreshText}>Đổi mã</Text>
          </Pressable>
        </View>

        {/* Segmented Gate Mode Toggle */}
        <View style={styles.toggleBar}>
          <Pressable
            style={[styles.toggleBtn, gateMode === 'in' && styles.toggleBtnActive]}
            onPress={() => setGateMode('in')}
          >
            <Text style={[styles.toggleBtnText, gateMode === 'in' && styles.toggleBtnTextActive]}>
              Vào cổng
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, gateMode === 'out' && styles.toggleBtnActive]}
            onPress={() => setGateMode('out')}
          >
            <Text style={[styles.toggleBtnText, gateMode === 'out' && styles.toggleBtnTextActive]}>
              Ra cổng
            </Text>
          </Pressable>
        </View>

        {/* Big White QR Card */}
        <View style={styles.qrCard}>
          {/* Detailed QR Pattern Graphic */}
          <View style={styles.qrFrame}>
            <View style={styles.qrRow}>
              <View style={styles.qrFinder}><View style={styles.qrFinderInner} /></View>
              <View style={styles.qrDotLine} />
              <View style={styles.qrFinder}><View style={styles.qrFinderInner} /></View>
            </View>

            <View style={styles.qrCenterGraphic}>
              <View style={styles.qrCenterBox}>
                <IconQrCode size={46} color="#0F172A" />
              </View>
            </View>

            <View style={styles.qrRow}>
              <View style={styles.qrFinder}><View style={styles.qrFinderInner} /></View>
              <View style={styles.qrDotLine} />
              <View style={styles.qrMiniBox} />
            </View>
          </View>

          {/* Site & Worker info */}
          <Text style={styles.siteText}>{siteName}</Text>
          <Text style={styles.workerText}>
            {workerName} · {workerCode}
          </Text>

          {/* Countdown */}
          <Text style={styles.countdownLabel}>Còn hiệu lực</Text>
          <Text style={styles.timerNumber}>{formatTimer(secondsRemaining)}</Text>

          {/* Progress Bar */}
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
          </View>

          {/* Scan Notice Badge */}
          <View style={styles.scanNoticeBox}>
            <Text style={styles.scanNoticeIcon}>⚲</Text>
            <Text style={styles.scanNoticeText}>Đưa mã cho nhân viên cổng quét</Text>
          </View>

          <Text style={styles.subHint}>
            Mã chỉ dùng một lần. Không thể tự xác nhận vào cổng.
          </Text>

          {/* Create New Code Button */}
          <Pressable
            style={({ pressed }) => [styles.newCodeBtn, pressed && { opacity: 0.85 }]}
            onPress={handleRefresh}
          >
            <Text style={styles.newCodeBtnText}>Tạo mã mới</Text>
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
    paddingBottom: 36,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sessionText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  sessionCode: {
    fontWeight: '800',
    color: '#0F1E36',
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
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
  qrCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EFF2F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
  },
  qrFrame: {
    width: 220,
    height: 220,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#0F172A',
    borderRadius: 16,
    padding: 14,
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  qrRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  qrFinder: {
    width: 50,
    height: 50,
    borderWidth: 6,
    borderColor: '#0F172A',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrFinderInner: {
    width: 20,
    height: 20,
    backgroundColor: '#0F172A',
    borderRadius: 3,
  },
  qrMiniBox: {
    width: 50,
    height: 50,
    backgroundColor: '#0F172A',
    borderRadius: 8,
  },
  qrDotLine: {
    width: 60,
    height: 24,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#64748B',
    borderRadius: 4,
  },
  qrCenterGraphic: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 60,
  },
  qrCenterBox: {
    padding: 8,
    backgroundColor: '#F8F9FA',
    borderRadius: 10,
  },
  siteText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F1E36',
    textAlign: 'center',
    marginBottom: 4,
  },
  workerText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  countdownLabel: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 2,
  },
  timerNumber: {
    fontSize: 34,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 1,
    marginBottom: 10,
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#F1F4F8',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  scanNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF4EE',
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 8,
    width: '100%',
    marginBottom: 12,
  },
  scanNoticeIcon: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '700',
  },
  scanNoticeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  subHint: {
    fontSize: 12,
    color: colors.textTertiary,
    textAlign: 'center',
    marginBottom: 20,
  },
  newCodeBtn: {
    width: '100%',
    borderWidth: 1.5,
    borderColor: colors.primaryBorder,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  newCodeBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
  },
});
