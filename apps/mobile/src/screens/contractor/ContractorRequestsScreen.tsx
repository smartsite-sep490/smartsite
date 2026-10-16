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
  IconCalendar,
  IconDocument,
  IconClock,
  IconChevronRight,
} from '../../components/common/Icons';

export interface ContractorRequestItem {
  id: string;
  type: 'adjustment' | 'leave' | 'overtime';
  typeTitle: string;
  workerName: string;
  workerCode?: string;
  timeSlot: string;
  reason: string;
  status: 'pending' | 'processed';
}

const REQUESTS_DATA: ContractorRequestItem[] = [
  {
    id: 'req-1',
    type: 'adjustment',
    typeTitle: 'Điều chỉnh công',
    workerName: 'Nguyễn Văn An',
    workerCode: 'W000123',
    timeSlot: '14/10 · 08:00 – 17:00',
    reason: 'Quên quét khi vào lại lúc 10:05',
    status: 'pending',
  },
  {
    id: 'req-2',
    type: 'leave',
    typeTitle: 'Xin nghỉ',
    workerName: 'Lê Văn Bình',
    workerCode: 'W000124',
    timeSlot: '20/10 – 21/10',
    reason: 'Việc gia đình',
    status: 'pending',
  },
  {
    id: 'req-3',
    type: 'overtime',
    typeTitle: 'Tăng ca',
    workerName: 'Phạm Thị Hoa',
    workerCode: 'W000131',
    timeSlot: '17/10 · 17:30 – 19:30',
    reason: 'Đổ bê tông sàn tầng 5',
    status: 'pending',
  },
  {
    id: 'req-4',
    type: 'leave',
    typeTitle: 'Xin nghỉ',
    workerName: 'Trần Văn Cường',
    workerCode: 'W000140',
    timeSlot: '22/10',
    reason: 'Khám sức khỏe',
    status: 'pending',
  },
];

interface ContractorRequestsScreenProps {
  onBack?: () => void;
  onSelectRequest?: (req: ContractorRequestItem) => void;
}

export function ContractorRequestsScreen({
  onBack,
  onSelectRequest,
}: ContractorRequestsScreenProps) {
  const [statusTab, setStatusTab] = useState<'pending' | 'processed'>('pending');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'leave' | 'overtime' | 'adjustment'>('all');

  const filtered = REQUESTS_DATA.filter((r) => {
    if (r.status !== statusTab) return false;
    if (categoryFilter === 'all') return true;
    return r.type === categoryFilter;
  });

  return (
    <View style={styles.container}>
      <ScreenHeader
        mode={onBack ? 'detail' : 'root'}
        onBack={onBack}
        tagline="Kết nối con người, xây dựng tương lai"
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Yêu cầu</Text>

        {/* Top Status Toggle: [Chờ duyệt (5)] | [Đã xử lý] */}
        <View style={styles.toggleBar}>
          <Pressable
            style={[styles.toggleBtn, statusTab === 'pending' && styles.toggleBtnActive]}
            onPress={() => setStatusTab('pending')}
          >
            <Text
              style={[
                styles.toggleBtnText,
                statusTab === 'pending' && styles.toggleBtnTextActive,
              ]}
            >
              Chờ duyệt (5)
            </Text>
          </Pressable>

          <Pressable
            style={[styles.toggleBtn, statusTab === 'processed' && styles.toggleBtnActive]}
            onPress={() => setStatusTab('processed')}
          >
            <Text
              style={[
                styles.toggleBtnText,
                statusTab === 'processed' && styles.toggleBtnTextActive,
              ]}
            >
              Đã xử lý
            </Text>
          </Pressable>
        </View>

        {/* Category Filter Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryScroll}
        >
          <Pressable
            style={[styles.chip, categoryFilter === 'all' && styles.chipNavyActive]}
            onPress={() => setCategoryFilter('all')}
          >
            <Text
              style={[
                styles.chipText,
                categoryFilter === 'all' && styles.chipTextNavyActive,
              ]}
            >
              Tất cả
            </Text>
          </Pressable>

          <Pressable
            style={[styles.chip, categoryFilter === 'leave' && styles.chipNavyActive]}
            onPress={() => setCategoryFilter('leave')}
          >
            <Text
              style={[
                styles.chipText,
                categoryFilter === 'leave' && styles.chipTextNavyActive,
              ]}
            >
              Xin nghỉ
            </Text>
          </Pressable>

          <Pressable
            style={[styles.chip, categoryFilter === 'overtime' && styles.chipNavyActive]}
            onPress={() => setCategoryFilter('overtime')}
          >
            <Text
              style={[
                styles.chipText,
                categoryFilter === 'overtime' && styles.chipTextNavyActive,
              ]}
            >
              Tăng ca
            </Text>
          </Pressable>

          <Pressable
            style={[styles.chip, categoryFilter === 'adjustment' && styles.chipNavyActive]}
            onPress={() => setCategoryFilter('adjustment')}
          >
            <Text
              style={[
                styles.chipText,
                categoryFilter === 'adjustment' && styles.chipTextNavyActive,
              ]}
            >
              Điều chỉnh công
            </Text>
          </Pressable>
        </ScrollView>

        {/* Requests Cards List */}
        <View style={styles.requestsList}>
          {filtered.map((req) => (
            <Pressable
              key={req.id}
              style={({ pressed }) => [styles.requestCard, pressed && { opacity: 0.88 }]}
              onPress={() => onSelectRequest?.(req)}
            >
              {/* Left Category Icon */}
              {req.type === 'adjustment' && (
                <View style={[styles.iconBox, { backgroundColor: '#EFF6FF' }]}>
                  <IconCalendar size={22} color="#2563EB" />
                </View>
              )}
              {req.type === 'leave' && (
                <View style={[styles.iconBox, { backgroundColor: '#FFF4EE' }]}>
                  <IconDocument size={22} color={colors.primary} />
                </View>
              )}
              {req.type === 'overtime' && (
                <View style={[styles.iconBox, { backgroundColor: '#FFF4EE' }]}>
                  <IconClock size={22} color={colors.primary} />
                </View>
              )}

              {/* Center Info */}
              <View style={styles.infoCol}>
                <Text style={styles.typeTitle}>{req.typeTitle}</Text>
                <Text style={styles.workerName}>{req.workerName}</Text>
                <Text style={styles.timeSlot}>{req.timeSlot}</Text>
                <Text style={styles.reason}>{req.reason}</Text>
              </View>

              {/* Right: Badge & Chevron */}
              <View style={styles.rightGroup}>
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>Chờ duyệt</Text>
                </View>
                <IconChevronRight size={18} color={colors.textTertiary} />
              </View>
            </Pressable>
          ))}
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
  toggleBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F4F8',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
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
  categoryScroll: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F1F4F8',
  },
  chipNavyActive: {
    backgroundColor: '#0F1E36',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextNavyActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  requestsList: {
    gap: 12,
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8F9FB',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCol: {
    flex: 1,
  },
  typeTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 2,
  },
  workerName: {
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: 4,
  },
  timeSlot: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 4,
  },
  reason: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  rightGroup: {
    alignItems: 'flex-end',
    gap: 16,
  },
  pendingBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
  },
});
