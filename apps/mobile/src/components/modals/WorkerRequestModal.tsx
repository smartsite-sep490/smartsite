import { translate as tr } from '../../i18n';
import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../../features/workspace/workspace-context';
import { useQuery } from '@tanstack/react-query';
import { allPages, localDate, required, useCommand } from '../../features/shared/data';
import { useTranslation } from '../../i18n';
import { IconChevronDown } from '../common/Icons';

interface WorkerRequestModalProps {
  visible: boolean;
  initialTab?: 'leave' | 'swap' | 'change' | 'adjustment';
  onClose: () => void;
  onSuccess?: () => void;
}

export function WorkerRequestModal({
  visible,
  initialTab = 'leave',
  onClose,
  onSuccess,
}: WorkerRequestModalProps) {
  const { t } = useTranslation();
  const { scope, client, token, workerId, queryKey } = useWorkspace();
  const [activeTab, setActiveTab] = useState<'leave' | 'swap' | 'change'>(
    initialTab === 'adjustment' ? 'change' : (initialTab as 'leave' | 'swap' | 'change'),
  );
  const [reason, setReason] = useState('');
  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [targetCoworkerId, setTargetCoworkerId] = useState('');
  const [targetShiftId, setTargetShiftId] = useState('');
  const [showScheduleDropdown, setShowScheduleDropdown] = useState(false);
  const [showSwapDropdown, setShowSwapDropdown] = useState(false);
  const [showShiftDropdown, setShowShiftDropdown] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const command = useCommand();

  const schedules = useQuery({
    queryKey: [...queryKey, 'my-schedules-for-request'],
    queryFn: () =>
      client.listWorkerSchedules(token, scope.siteId, {
        fromDate: localDate(),
        toDate: localDate(new Date(Date.now() + 14 * 86400000)),
        workerId: workerId || undefined,
        limit: 10,
        status: 'ALL',
      }),
    enabled: visible,
  });

  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts-for-request'],
    queryFn: ({ signal }) => allPages((p) => client.listShifts(token, scope.siteId, p), signal),
    enabled: visible,
  });

  const swapCandidates = useQuery({
    queryKey: [...queryKey, 'swap-candidates', selectedScheduleId],
    queryFn: () => client.listSwapCandidates(token, scope.siteId, selectedScheduleId),
    enabled: visible && activeTab === 'swap' && Boolean(selectedScheduleId),
  });

  const selectedSchedule = schedules.data?.items?.find((s) => s.id === selectedScheduleId);
  const selectedShift = selectedSchedule
    ? shifts.data?.find((s) => s.id === selectedSchedule.shiftId)
    : undefined;
  const selectedTargetShift = shifts.data?.find((s) => s.id === targetShiftId);

  const switchTab = (tab: 'leave' | 'swap' | 'change') => {
    setActiveTab(tab);
    setLocalError(null);
    setShowScheduleDropdown(false);
    setShowSwapDropdown(false);
    setShowShiftDropdown(false);
  };

  const handleSubmit = async () => {
    try {
      setLocalError(null);
      const why = required(reason, t('schedule.reason'));

      await command.mutateAsync(async () => {
        if (activeTab === 'leave') {
          if (!selectedScheduleId)
            throw new Error(t('schedule.shift') + ': ' + t('requests.selectShiftPlaceholder'));
          await client.createAbsenceRequest(token, scope.siteId, {
            workerScheduleId: selectedScheduleId,
            reason: why,
          });
        } else if (activeTab === 'swap') {
          if (!selectedScheduleId)
            throw new Error(t('schedule.shift') + ': ' + t('requests.selectShiftPlaceholder'));
          if (!targetCoworkerId)
            throw new Error(
              t('schedule.coworkerSchedule') + ': ' + t('requests.selectCoworkerPlaceholder'),
            );
          await client.createShiftSwapRequest(token, scope.siteId, {
            requesterWorkerScheduleId: selectedScheduleId,
            coworkerWorkerScheduleId: targetCoworkerId,
            reason: why,
          });
        } else {
          if (!selectedScheduleId)
            throw new Error(t('schedule.shift') + ': ' + t('requests.selectShiftPlaceholder'));
          if (!targetShiftId)
            throw new Error(
              t('requests.alternativeShift') +
                ': ' +
                t('requests.selectAlternativeShiftPlaceholder'),
            );
          await client.createShiftChangeRequest(token, scope.siteId, {
            workerScheduleId: selectedScheduleId,
            toShiftId: targetShiftId,
            reason: why,
          });
        }
      });
      setReason('');
      onSuccess?.();
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : t('common.unexpectedError'));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheetCard}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('requests.submitRequest')}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={10}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Segmented Tab Bar */}
          <View style={styles.tabBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('requests.typeLeave')}
              style={[styles.tabBtn, activeTab === 'leave' && styles.tabBtnActive]}
              onPress={() => switchTab('leave')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'leave' && styles.tabBtnTextActive]}>
                {t('requests.typeLeave')}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('requests.typeSwap')}
              style={[styles.tabBtn, activeTab === 'swap' && styles.tabBtnActive]}
              onPress={() => switchTab('swap')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'swap' && styles.tabBtnTextActive]}>
                {t('requests.typeSwap')}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('requests.typeChange')}
              style={[styles.tabBtn, activeTab === 'change' && styles.tabBtnActive]}
              onPress={() => switchTab('change')}
            >
              <Text style={[styles.tabBtnText, activeTab === 'change' && styles.tabBtnTextActive]}>
                {t('requests.typeChange')}
              </Text>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {/* Field: Schedule Selector */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('schedule.shift')}</Text>
              <Pressable
                style={styles.selectBox}
                onPress={() => {
                  setShowScheduleDropdown(!showScheduleDropdown);
                  setShowSwapDropdown(false);
                  setShowShiftDropdown(false);
                }}
              >
                <Text
                  style={selectedSchedule ? styles.selectTextActive : styles.selectTextPlaceholder}
                >
                  {selectedSchedule
                    ? `${selectedSchedule.workDate} · ${selectedShift?.name ?? tr('schedule.shift')}`
                    : t('requests.selectShiftPlaceholder')}
                </Text>
                <IconChevronDown size={18} color={colors.textMuted} />
              </Pressable>

              {showScheduleDropdown && (
                <View style={styles.dropdownList}>
                  {schedules.data?.items?.map((item) => {
                    const sh = shifts.data?.find((s) => s.id === item.shiftId);
                    return (
                      <Pressable
                        key={item.id}
                        style={[
                          styles.dropdownItem,
                          item.id === selectedScheduleId && styles.dropdownItemActive,
                        ]}
                        onPress={() => {
                          setSelectedScheduleId(item.id);
                          setShowScheduleDropdown(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.dropdownItemText,
                            item.id === selectedScheduleId && styles.dropdownItemTextActive,
                          ]}
                        >
                          {item.workDate} · {sh?.name ?? tr('schedule.shift')}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {!schedules.data?.items?.length && (
                    <Text style={styles.emptyNotice}>{t('schedule.noSchedules')}</Text>
                  )}
                </View>
              )}
            </View>

            {/* Field: Swap Target Coworker (when tab is swap) */}
            {activeTab === 'swap' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{t('schedule.coworkerSchedule')}</Text>
                <Pressable
                  style={styles.selectBox}
                  onPress={() => {
                    setShowSwapDropdown(!showSwapDropdown);
                    setShowScheduleDropdown(false);
                    setShowShiftDropdown(false);
                  }}
                >
                  <Text
                    style={
                      targetCoworkerId ? styles.selectTextActive : styles.selectTextPlaceholder
                    }
                  >
                    {swapCandidates.data?.items?.find(
                      (c) => c.candidateWorkerScheduleId === targetCoworkerId,
                    )
                      ? `${swapCandidates.data?.items?.find((c) => c.candidateWorkerScheduleId === targetCoworkerId)?.candidateWorkerDisplayName} (${swapCandidates.data?.items?.find((c) => c.candidateWorkerScheduleId === targetCoworkerId)?.workDate})`
                      : t('requests.selectCoworkerPlaceholder')}
                  </Text>
                  <IconChevronDown size={18} color={colors.textMuted} />
                </Pressable>

                {showSwapDropdown && (
                  <View style={styles.dropdownList}>
                    {swapCandidates.data?.items?.map((c) => (
                      <Pressable
                        key={c.candidateWorkerScheduleId}
                        style={[
                          styles.dropdownItem,
                          c.candidateWorkerScheduleId === targetCoworkerId &&
                            styles.dropdownItemActive,
                        ]}
                        onPress={() => {
                          setTargetCoworkerId(c.candidateWorkerScheduleId);
                          setShowSwapDropdown(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.dropdownItemText,
                            c.candidateWorkerScheduleId === targetCoworkerId &&
                              styles.dropdownItemTextActive,
                          ]}
                        >
                          {c.candidateWorkerDisplayName} ({c.workDate})
                        </Text>
                      </Pressable>
                    ))}
                    {!swapCandidates.data?.items?.length && (
                      <Text style={styles.emptyNotice}>{t('schedule.noCandidates')}</Text>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Field: Change Target Shift (when tab is change) */}
            {activeTab === 'change' && (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{t('requests.alternativeShift')}</Text>
                <Pressable
                  style={styles.selectBox}
                  onPress={() => {
                    setShowShiftDropdown(!showShiftDropdown);
                    setShowScheduleDropdown(false);
                    setShowSwapDropdown(false);
                  }}
                >
                  <Text
                    style={targetShiftId ? styles.selectTextActive : styles.selectTextPlaceholder}
                  >
                    {selectedTargetShift
                      ? `${selectedTargetShift.name} (${selectedTargetShift.startsAt} - ${selectedTargetShift.endsAt})`
                      : t('requests.selectAlternativeShiftPlaceholder')}
                  </Text>
                  <IconChevronDown size={18} color={colors.textMuted} />
                </Pressable>

                {showShiftDropdown && (
                  <View style={styles.dropdownList}>
                    {shifts.data
                      ?.filter((s) => s.id !== selectedShift?.id)
                      .map((sh) => (
                        <Pressable
                          key={sh.id}
                          style={[
                            styles.dropdownItem,
                            sh.id === targetShiftId && styles.dropdownItemActive,
                          ]}
                          onPress={() => {
                            setTargetShiftId(sh.id);
                            setShowShiftDropdown(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.dropdownItemText,
                              sh.id === targetShiftId && styles.dropdownItemTextActive,
                            ]}
                          >
                            {sh.name} ({sh.startsAt} - {sh.endsAt})
                          </Text>
                        </Pressable>
                      ))}
                    {!shifts.data?.length && (
                      <Text style={styles.emptyNotice}>{t('common.noOptions')}</Text>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Field: Lý do */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('schedule.reason')}</Text>
              <TextInput
                style={styles.textArea}
                placeholder={t('requests.reasonPlaceholder')}
                placeholderTextColor={colors.textMuted}
                value={reason}
                onChangeText={(v) => {
                  setReason(v);
                  if (localError) setLocalError(null);
                }}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            {/* Info hint banner */}
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerText}>
                {activeTab === 'leave'
                  ? t('requests.leaveNotice')
                  : activeTab === 'swap'
                    ? t('requests.swapNotice')
                    : t('requests.changeNotice')}
              </Text>
            </View>

            {/* Error Message */}
            {Boolean(localError || command.error) && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>
                  {localError ??
                    (command.error instanceof Error
                      ? command.error.message
                      : t('common.unexpectedError'))}
                </Text>
              </View>
            )}

            {/* Actions */}
            <View style={styles.actionsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
                style={styles.cancelBtn}
                onPress={onClose}
              >
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('requests.submitRequest')}
                style={[styles.submitBtn, command.isPending && { opacity: 0.7 }]}
                onPress={handleSubmit}
                disabled={command.isPending}
              >
                {command.isPending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitBtnText}>{t('requests.submitRequest')}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 30, 54, 0.45)',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF2F6',
    marginBottom: 14,
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
    flexShrink: 1,
    lineHeight: 24,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  closeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F4F8',
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 9,
    minWidth: 80,
    flexBasis: 80,
    paddingHorizontal: 6,
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  tabBtnText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    flexShrink: 1,
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  body: {
    paddingBottom: 10,
  },
  fieldGroup: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  selectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8F9FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectTextPlaceholder: {
    fontSize: 14,
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    lineHeight: 21,
  },
  selectTextActive: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    lineHeight: 21,
  },
  dropdownList: {
    marginTop: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    maxHeight: 180,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownItemActive: {
    backgroundColor: '#FFF4EE',
  },
  dropdownItemText: {
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  dropdownItemTextActive: {
    fontWeight: '700',
    color: colors.primary,
  },
  emptyNotice: {
    padding: 12,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  textArea: {
    backgroundColor: '#F8F9FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 80,
  },
  infoBanner: {
    backgroundColor: '#FEF9ED',
    borderWidth: 1,
    borderColor: '#FDECC8',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  infoBannerText: {
    fontSize: 12,
    color: '#92400E',
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 18,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    flexShrink: 1,
  },
  submitBtn: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
    minWidth: 152,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 22,
    flexShrink: 1,
  },
});
