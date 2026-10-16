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
  IconAlert,
} from '../../components/common/Icons';

type RequestTab = 'leave' | 'overtime' | 'adjustment';

interface RecentRequestItem {
  id: string;
  type: string;
  dates: string;
  status: 'Chờ duyệt' | 'Đã duyệt' | 'Từ chối';
}

interface WorkerRequestScreenProps {
  onBack: () => void;
  initialTab?: RequestTab;
}

export function WorkerRequestScreen({
  onBack,
  initialTab = 'leave',
}: WorkerRequestScreenProps) {
  const [activeTab, setActiveTab] = useState<RequestTab>(initialTab);
  const [shiftSelection] = useState('Ca hành chính · 08:00 – 17:00');
  const [fromDate, setFromDate] = useState('20/10/2026');
  const [toDate, setToDate] = useState('21/10/2026');
  const [reason, setReason] = useState('Về quê lo việc gia đình');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentRequests, setRecentRequests] = useState<RecentRequestItem[]>([
    {
      id: 'req-1',
      type: 'Xin nghỉ',
      dates: '20/10 – 21/10',
      status: 'Chờ duyệt',
    },
  ]);

  const handleSubmit = () => {
    if (!reason.trim()) {
      Alert.alert('Thông báo', 'Vui lòng nhập lý do gửi yêu cầu');
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      const typeLabel =
        activeTab === 'leave'
          ? 'Xin nghỉ'
          : activeTab === 'overtime'
          ? 'Tăng ca'
          : 'Điều chỉnh công';

      const newReq: RecentRequestItem = {
        id: `req-${Date.now()}`,
        type: typeLabel,
        dates: `${fromDate} – ${toDate}`,
        status: 'Chờ duyệt',
      };

      setRecentRequests([newReq, ...recentRequests]);
      setIsSubmitting(false);
      Alert.alert(
        'Gửi thành công',
        `Yêu cầu ${typeLabel} của bạn đã được gửi đến Đại diện nhà thầu để xét duyệt.`,
      );
    }, 600);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader mode="detail" onBack={onBack} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Gửi yêu cầu</Text>

        {/* 3-Tab Segmented Selector */}
        <View style={styles.tabBar}>
          <Pressable
            style={[styles.tabButton, activeTab === 'leave' && styles.tabButtonActive]}
            onPress={() => setActiveTab('leave')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'leave' && styles.tabButtonTextActive,
              ]}
            >
              Xin nghỉ
            </Text>
          </Pressable>

          <Pressable
            style={[styles.tabButton, activeTab === 'overtime' && styles.tabButtonActive]}
            onPress={() => setActiveTab('overtime')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'overtime' && styles.tabButtonTextActive,
              ]}
            >
              Tăng ca
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.tabButton,
              activeTab === 'adjustment' && styles.tabButtonActive,
            ]}
            onPress={() => setActiveTab('adjustment')}
          >
            <Text
              style={[
                styles.tabButtonText,
                activeTab === 'adjustment' && styles.tabButtonTextActive,
              ]}
            >
              Điều chỉnh công
            </Text>
          </Pressable>
        </View>

        {/* Form */}
        <View style={styles.formCard}>
          {/* Chọn ca */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Chọn ca</Text>
            <View style={styles.selectBox}>
              <Text style={styles.selectBoxText}>{shiftSelection}</Text>
              <IconChevronDown size={18} color={colors.textMuted} />
            </View>
          </View>

          {/* Date Pickers (2 Columns) */}
          <View style={styles.datesRow}>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Từ ngày</Text>
              <View style={styles.datePickerInput}>
                <TextInput
                  style={styles.dateText}
                  value={fromDate}
                  onChangeText={setFromDate}
                  placeholder="DD/MM/YYYY"
                />
                <IconCalendar size={18} color={colors.textMuted} />
              </View>
            </View>

            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.inputLabel}>Đến ngày</Text>
              <View style={styles.datePickerInput}>
                <TextInput
                  style={styles.dateText}
                  value={toDate}
                  onChangeText={setToDate}
                  placeholder="DD/MM/YYYY"
                />
                <IconCalendar size={18} color={colors.textMuted} />
              </View>
            </View>
          </View>

          {/* Lý do */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Lý do</Text>
            <TextInput
              style={styles.textArea}
              value={reason}
              onChangeText={setReason}
              multiline
              numberOfLines={4}
              placeholder="Nhập lý do chi tiết..."
              textAlignVertical="top"
            />
          </View>

          {/* Info Banner */}
          <View style={styles.infoBanner}>
            <IconAlert size={18} color={colors.warning} />
            <Text style={styles.infoBannerText}>
              Sau khi gửi, yêu cầu sẽ ở trạng thái Chờ duyệt
            </Text>
          </View>
        </View>

        {/* Section: Yêu cầu gần đây */}
        <View style={styles.recentSection}>
          <Text style={styles.recentTitle}>Yêu cầu gần đây</Text>

          {recentRequests.map((req) => (
            <View key={req.id} style={styles.recentCard}>
              <View>
                <Text style={styles.recentType}>{req.type}</Text>
                <Text style={styles.recentDates}>{req.dates}</Text>
              </View>
              <View style={styles.pendingBadge}>
                <Text style={styles.pendingBadgeText}>{req.status}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Primary Submit Button */}
        <Pressable
          style={({ pressed }) => [
            styles.submitBtn,
            (pressed || isSubmitting) && { opacity: 0.85 },
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Text style={styles.submitBtnText}>
            {isSubmitting ? 'Đang gửi…' : 'Gửi yêu cầu'}
          </Text>
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F4F8',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  tabButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabButtonTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  formCard: {
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  selectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFAFB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  selectBoxText: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  datesRow: {
    flexDirection: 'row',
    gap: 12,
  },
  datePickerInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFAFB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateText: {
    fontSize: 14,
    color: colors.textPrimary,
    fontWeight: '500',
    flex: 1,
    padding: 0,
  },
  textArea: {
    backgroundColor: '#FAFAFB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 100,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF9ED',
    borderWidth: 1,
    borderColor: '#FDECC8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  infoBannerText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
    flex: 1,
  },
  recentSection: {
    marginBottom: 24,
  },
  recentTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 12,
  },
  recentCard: {
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
  recentType: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  recentDates: {
    fontSize: 13,
    color: colors.textMuted,
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  pendingBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B45309',
  },
  submitBtn: {
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
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
