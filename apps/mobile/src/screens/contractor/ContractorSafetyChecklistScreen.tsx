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
import { IconCheck } from '../../components/common/Icons';

interface ChecklistItem {
  id: number;
  title: string;
  status: 'pass' | 'fail' | 'none';
  note?: string;
  hasPhoto?: boolean;
}

interface ContractorSafetyChecklistScreenProps {
  onBack: () => void;
  onSubmitSuccess?: () => void;
}

export function ContractorSafetyChecklistScreen({
  onBack,
  onSubmitSuccess,
}: ContractorSafetyChecklistScreenProps) {
  const [items, setItems] = useState<ChecklistItem[]>([
    {
      id: 1,
      title: '1. Công nhân đội mũ, đeo dây an toàn',
      status: 'pass',
    },
    {
      id: 2,
      title: '2. Lan can giàn giáo chắc chắn',
      status: 'pass',
    },
    {
      id: 3,
      title: '3. Lối thoát hiểm thông thoáng',
      status: 'fail',
      note: 'Có vật tư chắn lối tầng 3',
      hasPhoto: true,
    },
    {
      id: 4,
      title: '4. Bình chữa cháy còn hạn',
      status: 'none',
    },
  ]);

  const setItemStatus = (id: number, status: 'pass' | 'fail') => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, status } : it)),
    );
  };

  const setItemNote = (id: number, note: string) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, note } : it)),
    );
  };

  const completedCount = items.filter((it) => it.status !== 'none').length;
  const percentage = Math.round((completedCount / 5) * 100);

  const handleSubmit = () => {
    Alert.alert('Thành công', 'Đã gửi báo cáo kiểm tra an toàn giàn giáo đến Cán bộ an toàn.', [
      {
        text: 'Đóng',
        onPress: () => {
          onSubmitSuccess?.();
          onBack();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader mode="detail" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Top Header Card */}
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View style={styles.helmetIconCircle}>
              <Text style={styles.helmetEmoji}>⛑</Text>
            </View>
            <View style={styles.headerTitleGroup}>
              <Text style={styles.checklistTitle}>Kiểm tra an toàn giàn giáo</Text>
              <Text style={styles.checklistSub}>Công trường Riverside · Đội Thi công 01</Text>
            </View>
          </View>

          {/* Deadline Banner */}
          <View style={styles.deadlineContainer}>
            <Text style={styles.deadlineIcon}>🕒</Text>
            <Text style={styles.deadlineText}>Hạn hoàn thành: 17:00, 16/10/2026</Text>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressRow}>
            <Text style={styles.progressLabel}>3/5 tiêu chí</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${percentage}%` }]} />
            </View>
            <Text style={styles.progressPercentage}>60%</Text>
          </View>
        </View>

        {/* Checklist Criteria List */}
        <View style={styles.criteriaList}>
          {items.map((item) => {
            const isPass = item.status === 'pass';
            const isFail = item.status === 'fail';

            return (
              <View key={item.id} style={styles.criteriaCard}>
                <Text style={styles.criteriaTitle}>{item.title}</Text>

                {/* Pass / Fail Buttons */}
                <View style={styles.choiceRow}>
                  {/* Đạt */}
                  <Pressable
                    style={[styles.choiceBtn, isPass && styles.choiceBtnPassActive]}
                    onPress={() => setItemStatus(item.id, 'pass')}
                  >
                    {isPass ? (
                      <IconCheck size={16} color="#FFFFFF" />
                    ) : (
                      <View style={styles.radioEmpty} />
                    )}
                    <Text style={[styles.choiceBtnText, isPass && styles.choiceBtnTextPassActive]}>
                      Đạt
                    </Text>
                  </Pressable>

                  {/* Không đạt */}
                  <Pressable
                    style={[styles.choiceBtn, isFail && styles.choiceBtnFailActive]}
                    onPress={() => setItemStatus(item.id, 'fail')}
                  >
                    {isFail ? (
                      <Text style={styles.failIconWhite}>✕</Text>
                    ) : (
                      <View style={styles.radioEmpty} />
                    )}
                    <Text style={[styles.choiceBtnText, isFail && styles.choiceBtnTextFailActive]}>
                      Không đạt
                    </Text>
                  </Pressable>
                </View>

                {/* If Fail: Expanded Note & Photo Attachment (Screen 4) */}
                {isFail && (
                  <View style={styles.failDetailsBox}>
                    <Text style={styles.fieldLabel}>Ghi chú (bắt buộc)</Text>
                    <TextInput
                      style={styles.noteInput}
                      value={item.note || ''}
                      onChangeText={(txt) => setItemNote(item.id, txt)}
                      placeholder="Nhập ghi chú lỗi vi phạm..."
                    />

                    <Text style={styles.fieldLabel}>Ảnh minh họa</Text>
                    <View style={styles.photosRow}>
                      {/* Photo Thumbnail */}
                      <View style={styles.photoThumb}>
                        <View style={styles.photoPlaceholder}>
                          <Text style={styles.photoSignText}>KHU VỰC{'\n'}THI CÔNG</Text>
                        </View>
                        <Pressable style={styles.removePhotoBtn}>
                          <Text style={styles.removePhotoText}>✕</Text>
                        </Pressable>
                      </View>

                      {/* Attach Photo Dotted Box */}
                      <Pressable style={styles.attachBox}>
                        <Text style={styles.cameraIcon}>📷</Text>
                        <Text style={styles.attachText}>Đính kèm ảnh</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Bottom Button */}
        <Pressable
          style={({ pressed }) => [styles.submitBtn, pressed && { opacity: 0.88 }]}
          onPress={handleSubmit}
        >
          <Text style={styles.submitBtnText}>Gửi báo cáo</Text>
        </Pressable>

        <Text style={styles.footerNote}>Cán bộ an toàn sẽ xem xét và ghi nhận</Text>
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
  headerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  helmetIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  helmetEmoji: {
    fontSize: 24,
  },
  headerTitleGroup: {
    flex: 1,
  },
  checklistTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 2,
  },
  checklistSub: {
    fontSize: 12,
    color: colors.textMuted,
  },
  deadlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF9ED',
    borderWidth: 1,
    borderColor: '#FDECC8',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 6,
    marginBottom: 16,
  },
  deadlineIcon: {
    fontSize: 12,
  },
  deadlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B45309',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F1E36',
  },
  progressTrack: {
    flex: 1,
    height: 8,
    backgroundColor: '#F1F4F8',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressPercentage: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  criteriaList: {
    gap: 16,
    marginBottom: 24,
  },
  criteriaCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    padding: 16,
  },
  criteriaTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
    marginBottom: 12,
  },
  choiceRow: {
    flexDirection: 'row',
    gap: 12,
  },
  choiceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#F1F4F8',
    gap: 6,
  },
  choiceBtnPassActive: {
    backgroundColor: '#16A34A',
  },
  choiceBtnFailActive: {
    backgroundColor: '#DC2626',
  },
  radioEmpty: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
  },
  failIconWhite: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  choiceBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  choiceBtnTextPassActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  choiceBtnTextFailActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  failDetailsBox: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F4F8',
    paddingTop: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F1E36',
    marginBottom: 6,
  },
  noteInput: {
    backgroundColor: '#F8F9FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0F1E36',
    marginBottom: 12,
  },
  photosRow: {
    flexDirection: 'row',
    gap: 12,
  },
  photoThumb: {
    width: 90,
    height: 70,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  photoPlaceholder: {
    flex: 1,
    backgroundColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  photoSignText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#DC2626',
    textAlign: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: 3,
    right: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhotoText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  attachBox: {
    width: 110,
    height: 70,
    borderRadius: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  cameraIcon: {
    fontSize: 16,
  },
  attachText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
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
    marginBottom: 10,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  footerNote: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.textTertiary,
  },
});
