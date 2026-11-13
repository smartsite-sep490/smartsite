import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import { uiLocale, useTranslation } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { useWorkspace } from '../../features/workspace/workspace-context';
import { useScopedWorkers } from '../../features/workspace/use-scoped-workers';
import {
  allPages,
  localDate,
  useCommand,
  useRequestId,
  validDates,
} from '../../features/shared/data';
import { Button, Choice, Field } from '../../features/shared/ui';
import { assignmentEndDate, matchingVersions } from '../../features/scheduling/assignment-input';
import { shiftDayOffset, shiftRange } from '../../features/scheduling/schedule-calendar';
import {
  IconCalendar,
  IconClock,
  IconUser,
  IconUsers,
  IconAlert,
} from '../common/Icons';
import { colors } from '../../theme/colors';

interface ScheduleAssignModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type ScheduleAssignmentInput = Parameters<
  SmartSiteManagementClient['previewScheduleAssignment']
>[2];
type ScheduleAssignmentPreview = Awaited<
  ReturnType<SmartSiteManagementClient['previewScheduleAssignment']>
>;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.backendError?.issues?.length) {
    return error.backendError.issues
      .map((issue) => `${issue.path}: ${localizeMessage(issue.message)}`)
      .join('\n');
  }
  return error instanceof Error ? localizeMessage(error.message) : fallback;
}

export function ScheduleAssignModal({ visible, onClose, onSuccess }: ScheduleAssignModalProps) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [target, setTarget] = useState<'WORKER' | 'TEAM'>('WORKER');
  const [targetId, setTargetId] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [mode, setMode] = useState<ScheduleAssignmentInput['mode']>('DAY');
  const [todayDate] = useState(() => localDate());
  const [tomorrowDate] = useState(() => localDate(new Date(Date.now() + 86400000)));
  const [from, setFrom] = useState(localDate);
  const [to, setTo] = useState(localDate);
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [pickerField, setPickerField] = useState<'from' | 'to' | null>(null);
  const [preview, setPreview] = useState<{
    siteId: string;
    input: ScheduleAssignmentInput;
    result: ScheduleAssignmentPreview;
  } | null>(null);
  const [error, setError] = useState('');
  const [previewPending, setPreviewPending] = useState(false);
  const [commandSequence, setCommandSequence] = useState(0);
  const revision = useRef(0);
  const command = useCommand();
  const requestId = useRequestId();
  const workers = useScopedWorkers();
  const shifts = useQuery({
    queryKey: [...queryKey, 'assignment-shifts'],
    enabled: visible,
    queryFn: ({ signal }) => allPages((p) => client.listShifts(token, scope.siteId, p), signal),
  });
  const versions = useQuery({
    queryKey: [...queryKey, 'assignment-versions'],
    enabled: visible,
    queryFn: ({ signal }) =>
      allPages((p) => client.listScheduleVersions(token, scope.siteId, p), signal),
  });
  const teams = useQuery({
    queryKey: [...queryKey, 'assignment-teams'],
    enabled: visible,
    queryFn: ({ signal }) =>
      allPages(
        (p) =>
          client.listContractorTeams(token, scope.siteId, scope.contractorId, {
            ...p,
            status: 'ACTIVE',
          }),
        signal,
      ),
  });
  const teamWorkers = useQuery({
    queryKey: [...queryKey, 'assignment-team-workers'],
    enabled: visible,
    queryFn: ({ signal }) =>
      allPages(
        (p) => client.listContractorTeamWorkers(token, scope.siteId, scope.contractorId, p),
        signal,
      ),
  });
  const grants = useQuery({
    queryKey: [...queryKey, 'assignment-grants'],
    enabled: visible,
    queryFn: ({ signal }) =>
      allPages((p) => client.listShiftContractorAssignments(token, scope.siteId, p), signal),
  });
  const availableShifts = (shifts.data ?? []).filter(
    (s) =>
      !s.archivedAt &&
      grants.data?.some((g) => g.contractorId === scope.contractorId && g.shiftId === s.id),
  );
  const end = assignmentEndDate(mode, from, to);
  const availableVersions = matchingVersions(versions.data ?? [], from, end);
  const chosenVersion =
    availableVersions.find((v) => v.id === versionId) ??
    (availableVersions.length === 1 ? availableVersions[0] : undefined);
  const currentMembers = (teamWorkers.data ?? []).filter((w) => w.teamId === targetId);
  const loadError =
    workers.error ||
    shifts.error ||
    versions.error ||
    teams.error ||
    teamWorkers.error ||
    grants.error;
  const loading = [workers, shifts, versions, teams, teamWorkers, grants].some((q) => q.isPending);

  const update = (change: () => void) => {
    revision.current++;
    setPreview(null);
    setError('');
    change();
  };

  const showPreview = async () => {
    const currentRevision = revision.current;
    try {
      setPreviewPending(true);
      setError('');
      validDates(from, end);
      if (mode === 'WEEK' && new Date(`${from}T00:00:00Z`).getUTCDay() !== 1)
        throw new Error(t('scheduleAssign.mondayRequired'));
      if (
        !targetId ||
        !shiftId ||
        !chosenVersion ||
        (target === 'TEAM' && !members.length) ||
        !days.length
      )
        throw new Error(t('scheduleAssign.completeFields'));
      const input: ScheduleAssignmentInput = {
        contractorId: scope.contractorId,
        scheduleVersionId: chosenVersion.id,
        shiftId,
        target,
        ...(target === 'TEAM'
          ? { teamId: targetId, selectedWorkerIds: members }
          : { workerId: targetId }),
        mode,
        fromDate: from,
        toDate: end,
        weekdays: days,
      };
      const result = await client.previewScheduleAssignment(token, scope.siteId, input);
      if (revision.current === currentRevision) setPreview({ siteId: scope.siteId, input, result });
    } catch (e) {
      if (revision.current === currentRevision) {
        setPreview(null);
        setError(errorMessage(e, t('common.unexpectedError')));
      }
    } finally {
      setPreviewPending(false);
    }
  };

  const save = async () => {
    if (
      !preview ||
      preview.siteId !== scope.siteId ||
      preview.input.contractorId !== scope.contractorId ||
      preview.result.conflicts.length
    )
      return;
    try {
      setError('');
      const input = { ...preview.input, expectedFingerprint: preview.result.fingerprint };
      await command.mutateAsync(() =>
        client.createScheduleAssignment(token, scope.siteId, {
          ...input,
          requestId: requestId([commandSequence, scope.siteId, input]),
        }),
      );
      setCommandSequence((value) => value + 1);
      setPreview(null);
      onSuccess?.();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setPreview(null);
      setError(errorMessage(e, t('common.unexpectedError')));
    }
  };

  const close = () => {
    if (!command.isPending) {
      revision.current++;
      setPreview(null);
      setError('');
      setPickerField(null);
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.overlay}
      >
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          {/* Sheet Handle */}
          <View style={styles.dragHandle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <IconCalendar size={20} color={colors.primary} />
              </View>
              <View style={styles.headerTitles}>
                <Text style={styles.title}>{t('contractorHome.assignSchedule')}</Text>
                <View style={styles.subtitleRow}>
                  <View style={styles.scopeDot} />
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {scope.contractorName} · {scope.siteName}
                  </Text>
                </View>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
              onPress={close}
              style={styles.closeBtn}
              hitSlop={10}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.scrollContent}
          >
            {loading && (
              <View style={styles.loadingBox}>
                <Text style={styles.loadingText}>{t('common.loading')}</Text>
              </View>
            )}

            {loadError && (
              <View style={styles.errorBox}>
                <IconAlert size={18} color={colors.danger} />
                <Text style={styles.errorText}>{localizeMessage(loadError.message)}</Text>
                <Button
                  secondary
                  label={t('common.retry')}
                  onPress={() => {
                    void workers.refetch();
                    void shifts.refetch();
                    void versions.refetch();
                    void teams.refetch();
                    void teamWorkers.refetch();
                    void grants.refetch();
                  }}
                />
              </View>
            )}

            {/* SECTION 1: TARGET SELECTION */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <IconUser size={16} color={colors.primary} />
                <Text style={styles.sectionTitle}>{t('scheduleAssign.target')}</Text>
              </View>

              <Choice
                label={t('scheduleAssign.target')}
                value={target}
                options={[
                  { value: 'WORKER', label: t('schedule.worker') },
                  { value: 'TEAM', label: t('scheduleAssign.team') },
                ]}
                onChange={(value) =>
                  update(() => {
                    setTarget(value as 'WORKER' | 'TEAM');
                    setTargetId('');
                    setMembers([]);
                  })
                }
              />

              <Choice
                label={target === 'TEAM' ? t('scheduleAssign.team') : t('schedule.worker')}
                value={targetId}
                options={
                  target === 'TEAM'
                    ? (teams.data ?? []).map((v) => ({ value: v.id, label: v.name }))
                    : (workers.data ?? [])
                        .filter((w) => w.isActive)
                        .map((w) => ({ value: w.id, label: w.displayName }))
                }
                onChange={(value) =>
                  update(() => {
                    setTargetId(value);
                    setMembers(
                      (teamWorkers.data ?? [])
                        .filter((w) => w.teamId === value)
                        .map((w) => w.workerId),
                    );
                  })
                }
              />

              {target === 'TEAM' && targetId !== '' && (
                <View style={styles.membersContainer}>
                  <View style={styles.membersHeader}>
                    <View style={styles.membersHeaderLeft}>
                      <IconUsers size={16} color={colors.textSecondary} />
                      <Text style={styles.membersLabel}>{t('scheduleAssign.members')}</Text>
                    </View>
                    <View style={styles.membersActions}>
                      <Pressable
                        onPress={() =>
                          update(() => {
                            const allIds = currentMembers.map((w) => w.workerId);
                            const isAllSelected = members.length === allIds.length;
                            setMembers(isAllSelected ? [] : allIds);
                          })
                        }
                        hitSlop={6}
                      >
                        <Text style={styles.selectAllText}>
                          {members.length === currentMembers.length
                            ? t('common.all') + ' ✓'
                            : t('common.all')}
                        </Text>
                      </Pressable>
                      <View style={styles.countBadge}>
                        <Text style={styles.countBadgeText}>
                          {members.length}/{currentMembers.length}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.membersList}>
                    {currentMembers.map((member) => {
                      const isSelected = members.includes(member.workerId);
                      return (
                        <Pressable
                          key={member.workerId}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isSelected }}
                          onPress={() =>
                            update(() =>
                              setMembers((old) =>
                                old.includes(member.workerId)
                                  ? old.filter((id) => id !== member.workerId)
                                  : [...old, member.workerId],
                              ),
                            )
                          }
                          style={[styles.memberRow, isSelected && styles.memberRowSelected]}
                        >
                          <View
                            style={[styles.checkboxBox, isSelected && styles.checkboxBoxSelected]}
                          >
                            {isSelected && <Text style={styles.checkmarkText}>✓</Text>}
                          </View>
                          <View style={styles.memberAvatar}>
                            <Text style={styles.avatarInitial}>
                              {(member.displayName || '?').charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.memberNameText,
                              isSelected && styles.memberNameTextSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {member.displayName}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* SECTION 2: SHIFT & TIME */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <IconClock size={16} color={colors.primary} />
                <Text style={styles.sectionTitle}>{t('schedule.time')}</Text>
              </View>

              <Choice
                label={t('schedule.shift')}
                value={shiftId}
                options={availableShifts.map((s) => ({
                  value: s.id,
                  label: `${s.name} (${shiftRange(s)}${shiftDayOffset(s) > 0 ? ` ${t('schedule.nextDay', { count: shiftDayOffset(s) })}` : ''})`,
                }))}
                onChange={(v) => update(() => setShiftId(v))}
              />

              <Choice
                label={t('scheduleAssign.mode')}
                value={mode}
                options={[
                  { value: 'DAY', label: t('scheduleAssign.day') },
                  { value: 'WEEK', label: t('scheduleAssign.week') },
                  { value: 'REPEAT', label: t('scheduleAssign.repeat') },
                ]}
                onChange={(v) => update(() => setMode(v as ScheduleAssignmentInput['mode']))}
              />

              {/* Date Input with Quick Shortcuts & Calendar Picker */}
              <View style={styles.dateFieldWrapper}>
                <View style={styles.quickDateRow}>
                  <Pressable
                    onPress={() => update(() => setFrom(todayDate))}
                    style={[styles.quickChip, from === todayDate && styles.quickChipActive]}
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        from === todayDate && styles.quickChipTextActive,
                      ]}
                    >
                      {t('common.today')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => update(() => setFrom(tomorrowDate))}
                    style={[styles.quickChip, from === tomorrowDate && styles.quickChipActive]}
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        from === tomorrowDate && styles.quickChipTextActive,
                      ]}
                    >
                      +1 {t('common.next')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setPickerField('from')}
                    style={styles.pickerTriggerBtn}
                  >
                    <Text style={styles.pickerTriggerText}>{t('scheduleAssign.chooseCalendar')}</Text>
                  </Pressable>
                </View>

                <Field
                  label={`${mode === 'DAY' ? t('schedule.date') : t('schedule.fromDate')} (YYYY-MM-DD)`}
                  value={from}
                  onChangeText={(v) => update(() => setFrom(v))}
                />
              </View>

              {mode === 'WEEK' && (
                <View style={styles.hintCard}>
                  <Text style={styles.hintIcon}>ℹ</Text>
                  <Text style={styles.hintText}>{t('scheduleAssign.weekHint', { date: end })}</Text>
                </View>
              )}

              {mode === 'REPEAT' && (
                <View style={styles.dateFieldWrapper}>
                  <View style={styles.quickDateRow}>
                    <Pressable
                      onPress={() =>
                        update(() => setTo(localDate(new Date(Date.now() + 7 * 86400000))))
                      }
                      style={styles.quickChip}
                    >
                      <Text style={styles.quickChipText}>+7 {t('common.date').toLowerCase()}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        update(() => setTo(localDate(new Date(Date.now() + 14 * 86400000))))
                      }
                      style={styles.quickChip}
                    >
                      <Text style={styles.quickChipText}>+14 {t('common.date').toLowerCase()}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setPickerField('to')}
                      style={styles.pickerTriggerBtn}
                    >
                      <Text style={styles.pickerTriggerText}>{t('scheduleAssign.chooseCalendar')}</Text>
                    </Pressable>
                  </View>
                  <Field
                    label={`${t('schedule.toDate')} (YYYY-MM-DD)`}
                    value={to}
                    onChangeText={(v) => update(() => setTo(v))}
                  />
                </View>
              )}

              {mode !== 'DAY' && (
                <View style={styles.weekdaysWrapper}>
                  <View style={styles.weekdaysHeader}>
                    <Text style={styles.weekdaysLabel}>{t('scheduleAssign.weekdays')}</Text>
                    <View style={styles.weekdaysQuickRow}>
                      <Pressable
                        onPress={() => update(() => setDays([1, 2, 3, 4, 5]))}
                        style={styles.weekdayQuickBtn}
                      >
                        <Text style={styles.weekdayQuickText}>T2 - T6</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => update(() => setDays([1, 2, 3, 4, 5, 6, 7]))}
                        style={styles.weekdayQuickBtn}
                      >
                        <Text style={styles.weekdayQuickText}>{t('common.all')}</Text>
                      </Pressable>
                    </View>
                  </View>
                  <View style={styles.weekdayChipsRow}>
                    {[1, 2, 3, 4, 5, 6, 7].map((day) => {
                      const isSelected = days.includes(day);
                      return (
                        <Pressable
                          key={day}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isSelected }}
                          onPress={() =>
                            update(() =>
                              setDays((old) =>
                                old.includes(day)
                                  ? old.filter((d) => d !== day)
                                  : [...old, day].sort(),
                              ),
                            )
                          }
                          style={[
                            styles.weekdayChip,
                            isSelected && styles.weekdayChipSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.weekdayChipText,
                              isSelected && styles.weekdayChipTextSelected,
                            ]}
                          >
                            {t(`schedule.weekday${day % 7}`)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* SECTION 3: VERSION (if multiple) */}
            {availableVersions.length > 1 && (
              <View style={styles.sectionCard}>
                <Choice
                  label={t('scheduleAssign.version')}
                  value={chosenVersion?.id ?? ''}
                  options={availableVersions.map((v) => ({
                    value: v.id,
                    label: `${v.version} · ${v.effectiveFrom.slice(0, 10)} – ${v.effectiveUntil?.slice(0, 10) ?? '…'}`,
                  }))}
                  onChange={(v) => update(() => setVersionId(v))}
                />
              </View>
            )}

            {!chosenVersion && <Text style={styles.error}>{t('scheduleAssign.noVersion')}</Text>}

            {error !== '' && (
              <View style={styles.errorBox}>
                <IconAlert size={18} color={colors.danger} />
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {error}
                </Text>
              </View>
            )}

            {/* PREVIEW CARD */}
            {preview && (
              <View style={styles.previewCard}>
                <View style={styles.previewHeader}>
                  <Text style={styles.previewTitle}>{t('scheduleAssign.previewTitle')}</Text>
                  {preview.result.conflicts.length > 0 ? (
                    <View style={styles.conflictBadge}>
                      <Text style={styles.conflictBadgeText}>
                        {t('scheduleAssign.conflictsCount', { count: preview.result.conflicts.length })}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.validBadge}>
                      <Text style={styles.validBadgeText}>{t('scheduleAssign.valid')}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.previewMetricsRow}>
                  <View style={styles.metricChip}>
                    <Text style={styles.metricVal}>{preview.result.members.length}</Text>
                    <Text style={styles.metricLbl}>{t('schedule.worker')}</Text>
                  </View>
                  <View style={styles.metricChip}>
                    <Text style={styles.metricVal}>{preview.result.dates.length}</Text>
                    <Text style={styles.metricLbl}>{t('common.date')}</Text>
                  </View>
                  <View style={styles.metricChip}>
                    <Text style={styles.metricVal}>{preview.result.assignmentCount}</Text>
                    <Text style={styles.metricLbl}>{t('scheduleAssign.assignmentCountLabel')}</Text>
                  </View>
                </View>

                <View style={styles.previewDetailSection}>
                  <Text style={styles.previewDetailLabel}>{t('scheduleAssign.members')}:</Text>
                  <Text style={styles.previewDetailText}>
                    {preview.result.members.map((m) => m.workerName).join(', ')}
                  </Text>
                </View>

                <View style={styles.previewDetailSection}>
                  <Text style={styles.previewDetailLabel}>{t('common.date')}:</Text>
                  <Text style={styles.previewDetailText}>{preview.result.dates.join(', ')}</Text>
                </View>

                {preview.result.conflicts.length > 0 && (
                  <View style={styles.conflictsBox}>
                    <Text style={styles.conflictsTitle}>{t('scheduleAssign.conflictsList')}</Text>
                    {preview.result.conflicts.map((c) => (
                      <View
                        key={`${c.workerId}-${c.workDate}-${c.scheduleId}`}
                        style={styles.conflictItem}
                      >
                        <Text style={styles.conflictText}>
                          • {c.workerName} · {c.workDate} · {c.shiftName}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* ACTION BUTTONS (Horizontal Layout) */}
            <View style={styles.actionsRow}>
              <View style={styles.actionBtnCancel}>
                <Button secondary label={t('common.cancel')} onPress={close} />
              </View>
              <View style={styles.actionBtnPreview}>
                <Button
                  secondary
                  label={t('scheduleAssign.preview')}
                  disabled={loading || !!loadError || command.isPending || previewPending}
                  onPress={() => void showPreview()}
                />
              </View>
              <View style={styles.actionBtnSave}>
                <Button
                  label={t('common.save')}
                  disabled={
                    !preview ||
                    preview.siteId !== scope.siteId ||
                    preview.input.contractorId !== scope.contractorId ||
                    !!preview.result.conflicts.length ||
                    command.isPending ||
                    previewPending
                  }
                  onPress={() => void save()}
                />
              </View>
            </View>
          </ScrollView>

          {/* Native Date Picker Modal */}
          {pickerField && (
            <DateTimePicker
              locale={uiLocale()}
              value={
                (() => {
                  const val = pickerField === 'from' ? from : to;
                  const parsed = val && !isNaN(Date.parse(val)) ? new Date(`${val}T00:00:00`) : new Date();
                  return isNaN(parsed.getTime()) ? new Date() : parsed;
                })()
              }
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, selected) => {
                if (Platform.OS !== 'ios') setPickerField(null);
                if (event.type === 'set' && selected) {
                  const dateStr = localDate(selected);
                  update(() => {
                    if (pickerField === 'from') setFrom(dateStr);
                    else setTo(dateStr);
                  });
                }
              }}
            />
          )}

          {Platform.OS === 'ios' && pickerField && (
            <View style={styles.pickerDoneRow}>
              <Button label={t('common.done')} onPress={() => setPickerField(null)} />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    maxHeight: '88%',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 10,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 12,
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitles: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  scopeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    flexShrink: 1,
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
  scrollContent: {
    paddingBottom: 28,
    gap: 14,
  },
  sectionCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F1E36',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  membersContainer: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  membersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  membersHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  membersLabel: {
    fontWeight: '700',
    fontSize: 13,
    color: '#0F1E36',
  },
  membersActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  countBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  membersList: {
    gap: 6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  memberRowSelected: {
    backgroundColor: '#FFF4EE',
    borderColor: '#FDCDB8',
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxBoxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmarkText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
  memberAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  memberNameText: {
    fontSize: 13.5,
    color: '#334155',
    fontWeight: '500',
    flex: 1,
  },
  memberNameTextSelected: {
    color: '#0F1E36',
    fontWeight: '700',
  },
  dateFieldWrapper: {
    marginTop: 2,
  },
  quickDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  quickChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  quickChipActive: {
    backgroundColor: '#FFF4EE',
    borderColor: colors.primary,
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  quickChipTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  pickerTriggerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#FFF4EE',
    borderWidth: 1,
    borderColor: '#FDCDB8',
  },
  pickerTriggerText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF9ED',
    borderWidth: 1,
    borderColor: '#FDECC8',
    borderRadius: 12,
    padding: 10,
    marginTop: 2,
  },
  hintIcon: {
    fontSize: 14,
    color: '#B45309',
  },
  hintText: {
    fontSize: 12.5,
    color: '#92400E',
    flex: 1,
    lineHeight: 18,
  },
  weekdaysWrapper: {
    marginTop: 4,
  },
  weekdaysHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  weekdaysLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F1E36',
  },
  weekdaysQuickRow: {
    flexDirection: 'row',
    gap: 6,
  },
  weekdayQuickBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  weekdayQuickText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  weekdayChipsRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between',
  },
  weekdayChip: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 2,
  },
  weekdayChipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
  },
  weekdayChipTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  previewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    padding: 14,
    gap: 10,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
  },
  validBadge: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  validBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  conflictBadge: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  conflictBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B91C1C',
  },
  previewMetricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricChip: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricVal: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primary,
  },
  metricLbl: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  previewDetailSection: {
    gap: 2,
  },
  previewDetailLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  previewDetailText: {
    fontSize: 13,
    color: '#1E293B',
    lineHeight: 18,
  },
  conflictsBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FEE2E2',
    gap: 4,
    marginTop: 4,
  },
  conflictsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991B1B',
  },
  conflictItem: {
    paddingVertical: 2,
  },
  conflictText: {
    fontSize: 12,
    color: '#B91C1C',
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  actionBtnCancel: {
    flex: 0.9,
  },
  actionBtnPreview: {
    flex: 1.2,
  },
  actionBtnSave: {
    flex: 1.2,
  },
  pickerDoneRow: {
    paddingTop: 8,
  },
  loadingBox: {
    padding: 12,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  error: {
    color: '#B91C1C',
    marginVertical: 4,
    fontSize: 13,
  },
});
