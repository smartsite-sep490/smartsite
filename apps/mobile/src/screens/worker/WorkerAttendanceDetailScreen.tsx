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
  IconCheck,
  IconChevronDown,
  IconChevronUp,
} from '../../components/common/Icons';

interface WorkerAttendanceDetailScreenProps {
  onBack: () => void;
  onRequestAdjustment: () => void;
}

export function WorkerAttendanceDetailScreen({
  onBack,
  onRequestAdjustment,
}: WorkerAttendanceDetailScreenProps) {
  const [ruleExpanded, setRuleExpanded] = useState<boolean>(true);

  return (
    <View style={styles.container}>
      <ScreenHeader mode="detail" onBack={onBack} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title and Confirmation Badge */}
        <View style={styles.headerRow}>
          <View style={styles.headerTextCol}>
            <Text style={styles.title}>Chi tiết chấm công</Text>
            <Text style={styles.subtitle}>
              Thứ Năm, 15/10/2026 · Ca 08:00 – 17:00
            </Text>
          </View>
          <View style={styles.confirmedBadge}>
            <IconCheck size={14} color={colors.success} />
            <Text style={styles.confirmedBadgeText}>Đã xác nhận</Text>
          </View>
        </View>

        {/* 4 Stats Summary Panel */}
        <View style={styles.statsCard}>
          <View style={styles.statCol}>
            <Text style={styles.statColLabel}>Giờ thường</Text>
            <Text style={styles.statColValue}>7g 50p</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statColLabel}>Tăng ca</Text>
            <Text style={styles.statColValue}>0g</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statColLabel}>Lượt ra ngoài</Text>
            <Text style={styles.statColValue}>1</Text>
          </View>
          <View style={styles.statCol}>
            <Text style={styles.statColLabel}>Bị trừ</Text>
            <Text style={styles.statColValue}>10 phút</Text>
          </View>
        </View>

        {/* Timeline: Lịch sử vào/ra */}
        <View style={styles.timelineCard}>
          <Text style={styles.cardHeading}>Lịch sử vào/ra</Text>

          <View style={styles.timelineContainer}>
            {/* Event 1 */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineLeftTrack}>
                <View style={[styles.timelineDot, { backgroundColor: colors.success }]} />
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineContent}>
                <View style={styles.timeTitleRow}>
                  <Text style={styles.timelineTime}>07:52</Text>
                  <Text style={styles.timelineDesc}>Vào cổng chính</Text>
                </View>
              </View>
            </View>

            {/* Event 2 */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineLeftTrack}>
                <View style={[styles.timelineDot, { backgroundColor: colors.warning }]} />
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineContent}>
                <View style={styles.timeTitleRow}>
                  <Text style={styles.timelineTime}>09:40</Text>
                  <Text style={styles.timelineDesc}>Ra ngoài</Text>
                </View>
              </View>
            </View>

            {/* Event 3 */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineLeftTrack}>
                <View style={[styles.timelineDot, { backgroundColor: colors.success }]} />
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineContent}>
                <View style={styles.timeTitleRow}>
                  <Text style={styles.timelineTime}>10:05</Text>
                  <Text style={styles.timelineDesc}>Vào lại</Text>
                </View>
                {/* Highlight amber tag */}
                <View style={styles.deductionTag}>
                  <Text style={styles.deductionTagText}>
                    Ra ngoài 25 phút, trừ 10 phút
                  </Text>
                </View>
              </View>
            </View>

            {/* Event 4: Nghỉ trưa */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineLeftTrack}>
                <View style={[styles.timelineDot, { backgroundColor: '#94A3B8' }]} />
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineContent}>
                <View style={styles.timeTitleRow}>
                  <Text style={styles.timelineTimeMuted}>12:00 – 13:00</Text>
                  <Text style={styles.timelineDescMuted}>Nghỉ trưa</Text>
                </View>
              </View>
            </View>

            {/* Event 5: Ra cổng */}
            <View style={[styles.timelineItem, { marginBottom: 0 }]}>
              <View style={styles.timelineLeftTrack}>
                <View style={[styles.timelineDot, { backgroundColor: colors.success }]} />
              </View>
              <View style={styles.timelineContent}>
                <View style={styles.timeTitleRow}>
                  <Text style={styles.timelineTime}>17:30</Text>
                  <Text style={styles.timelineDesc}>Ra cổng</Text>
                </View>
                <Text style={styles.timelineNote}>Không cộng thêm giờ thường</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Collapsible: Quy tắc tính công */}
        <View style={styles.ruleCard}>
          <Pressable
            style={styles.ruleHeader}
            onPress={() => setRuleExpanded(!ruleExpanded)}
          >
            <Text style={styles.ruleTitle}>Quy tắc tính công</Text>
            {ruleExpanded ? (
              <IconChevronUp size={20} color={colors.textPrimary} />
            ) : (
              <IconChevronDown size={20} color={colors.textPrimary} />
            )}
          </Pressable>

          {ruleExpanded && (
            <View style={styles.ruleBody}>
              <Text style={styles.ruleText}>
                Miễn trừ 15 phút mỗi lượt, tối đa 2 lượt.
                {'\n'}Từ lượt thứ 3 trừ toàn bộ.
              </Text>
            </View>
          )}
        </View>

        {/* Bottom Action: Yêu cầu điều chỉnh */}
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.88 }]}
          onPress={onRequestAdjustment}
        >
          <Text style={styles.primaryBtnText}>Yêu cầu điều chỉnh</Text>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  headerTextCol: {
    flex: 1,
    paddingRight: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textMuted,
  },
  confirmedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  confirmedBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.successText,
  },
  statsCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 18,
  },
  statCol: {
    alignItems: 'flex-start',
  },
  statColLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 6,
  },
  statColValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0B1B33',
    letterSpacing: -0.3,
  },
  timelineCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 18,
  },
  cardHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 16,
  },
  timelineContainer: {
    paddingLeft: 4,
  },
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 22,
  },
  timelineLeftTrack: {
    alignItems: 'center',
    width: 24,
    marginRight: 14,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E2E8F0',
    marginTop: 4,
    marginBottom: -4,
  },
  timelineContent: {
    flex: 1,
  },
  timeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  timelineTime: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
    width: 50,
  },
  timelineDesc: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F1E36',
  },
  timelineTimeMuted: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    width: 100,
  },
  timelineDescMuted: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  deductionTag: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 8,
    marginLeft: 66,
  },
  deductionTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B45309',
  },
  timelineNote: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
    marginLeft: 66,
  },
  ruleCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 24,
    overflow: 'hidden',
  },
  ruleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
  },
  ruleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1E36',
  },
  ruleBody: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: '#EFF2F6',
    paddingTop: 12,
  },
  ruleText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  primaryBtn: {
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
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
