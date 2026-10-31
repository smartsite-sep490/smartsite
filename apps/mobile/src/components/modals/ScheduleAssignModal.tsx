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
import { useScopedWorkers } from '../../features/workspace/use-scoped-workers';
import { useQuery } from '@tanstack/react-query';
import { allPages, localDate, useCommand, validDates } from '../../features/shared/data';
import { useTranslation } from '../../i18n';
import { IconCalendar, IconChevronDown } from '../common/Icons';

interface ScheduleAssignModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ScheduleAssignModal({ visible, onClose, onSuccess }: ScheduleAssignModalProps) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const today = localDate();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [showShiftPicker, setShowShiftPicker] = useState(false);
  const [showWorkerPicker, setShowWorkerPicker] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const command = useCommand();

  const workers = useScopedWorkers();
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts-for-assign'],
    queryFn: ({ signal }) => allPages((p) => client.listShifts(token, scope.siteId, p), signal),
    enabled: visible,
  });

  const selectedShift = shifts.data?.find((s) => s.id === selectedShiftId);
  const selectedWorker = workers.data?.find((w) => w.id === selectedWorkerId);

  const handleAssign = async () => {
    try {
      setLocalError(null);
      validDates(fromDate, toDate);
      if (!selectedShiftId) throw new Error(t('schedule.shift') + ': ' + t('common.noOptions'));
      if (!selectedWorkerId) throw new Error(t('workforce.title') + ': ' + t('common.noOptions'));

      await command.mutateAsync(async () => {
        const versions = await client.listScheduleVersions(token, scope.siteId);
        const scheduleVersionId = versions.items[0]?.id;
        if (!scheduleVersionId) throw new Error(tr('schedule.noActiveVersion'));
        const input = {
          contractorId: scope.contractorId,
          scheduleVersionId,
          shiftId: selectedShiftId,
          target: 'WORKER' as const,
          workerId: selectedWorkerId,
          mode: fromDate === toDate ? ('DAY' as const) : ('WEEK' as const),
          fromDate,
          toDate,
          weekdays: [1, 2, 3, 4, 5, 6, 7],
        };
        const preview = await client.previewScheduleAssignment(token, scope.siteId, input);
        await client.createScheduleAssignment(token, scope.siteId, {
          ...input,
          requestId: `${Date.now()}-${selectedWorkerId}`,
          expectedFingerprint: preview.fingerprint,
        });
      });
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
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <IconCalendar size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.title}>{t('contractorHome.assignSchedule')}</Text>
                <Text style={styles.subtitle}>
                  {scope.contractorName} · {scope.siteName}
                </Text>
              </View>
            </View>
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

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
            {/* Field: Worker Picker */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('workforce.title')}</Text>
              <Pressable
                style={styles.selectBox}
                onPress={() => {
                  setShowWorkerPicker(!showWorkerPicker);
                  setShowShiftPicker(false);
                }}
              >
                <Text
                  style={selectedWorker ? styles.selectTextActive : styles.selectTextPlaceholder}
                >
                  {selectedWorker?.displayName ?? t('workforce.searchPlaceholder')}
                </Text>
                <IconChevronDown size={18} color={colors.textMuted} />
              </Pressable>

              {showWorkerPicker && (
                <View style={styles.dropdownList}>
                  {workers.data?.map((w) => (
                    <Pressable
                      key={w.id}
                      style={[
                        styles.dropdownItem,
                        w.id === selectedWorkerId && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedWorkerId(w.id);
                        setShowWorkerPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          w.id === selectedWorkerId && styles.dropdownItemTextActive,
                        ]}
                      >
                        {w.displayName} ({w.externalId})
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Field: Shift Picker */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>{t('schedule.shift')}</Text>
              <Pressable
                style={styles.selectBox}
                onPress={() => {
                  setShowShiftPicker(!showShiftPicker);
                  setShowWorkerPicker(false);
                }}
              >
                <Text
                  style={selectedShift ? styles.selectTextActive : styles.selectTextPlaceholder}
                >
                  {selectedShift
                    ? `${selectedShift.name} (${selectedShift.startsAt?.slice(11, 16) ?? ''} – ${selectedShift.endsAt?.slice(11, 16) ?? ''})`
                    : t('common.noOptions')}
                </Text>
                <IconChevronDown size={18} color={colors.textMuted} />
              </Pressable>

              {showShiftPicker && (
                <View style={styles.dropdownList}>
                  {shifts.data?.map((s) => (
                    <Pressable
                      key={s.id}
                      style={[
                        styles.dropdownItem,
                        s.id === selectedShiftId && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedShiftId(s.id);
                        setShowShiftPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownItemText,
                          s.id === selectedShiftId && styles.dropdownItemTextActive,
                        ]}
                      >
                        {s.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Field: Dates Row */}
            <View style={styles.datesRow}>
              <View style={[styles.fieldGroup, { flex: 1, minWidth: 140 }]}>
                <Text style={styles.label}>{t('schedule.fromDate')} (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.input}
                  value={fromDate}
                  onChangeText={(v) => {
                    setFromDate(v);
                    if (localError) setLocalError(null);
                  }}
                  placeholder="YYYY-MM-DD"
                />
              </View>

              <View style={[styles.fieldGroup, { flex: 1, minWidth: 140 }]}>
                <Text style={styles.label}>{t('schedule.toDate')} (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.input}
                  value={toDate}
                  onChangeText={(v) => {
                    setToDate(v);
                    if (localError) setLocalError(null);
                  }}
                  placeholder="YYYY-MM-DD"
                />
              </View>
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

            {/* Actions Row */}
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
                accessibilityLabel={t('contractorHome.assignSchedule')}
                style={[styles.submitBtn, command.isPending && { opacity: 0.7 }]}
                onPress={handleAssign}
                disabled={command.isPending}
              >
                {command.isPending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.submitBtnText}>{t('common.save')}</Text>
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
    maxHeight: '85%',
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
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EFF2F6',
    marginBottom: 16,
    gap: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
    flexShrink: 1,
    lineHeight: 24,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
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
    fontSize: 14,
    color: colors.textPrimary,
  },
  dropdownItemTextActive: {
    fontWeight: '700',
    color: colors.primary,
  },
  datesRow: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  input: {
    backgroundColor: '#F8F9FB',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: colors.textPrimary,
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
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
