import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
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
import { Button, Choice, CompactTabs } from '../../features/shared/ui';
import { CalendarDateField } from '../../features/shared/calendar-date-field';
import { assignmentEndDate, matchingVersions } from '../../features/scheduling/assignment-input';
import { shiftDayOffset, shiftRange } from '../../features/scheduling/schedule-calendar';
import { IconCalendar, IconUsers, IconAlert } from '../common/Icons';
import { colors } from '../../theme/colors';

import { RequestSheet } from '../../features/shared/request-sheet';
import { FormSection } from '../../features/shared/form-section';

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
      onClose();
    }
  };

  return (
    <RequestSheet
      visible={visible}
      variant="form"
      busy={command.isPending}
      onClose={close}
      title={t('contractorHome.assignSchedule')}
      subtitle={scope.contractorName + ' · ' + scope.siteName}
      icon={<IconCalendar size={23} color={colors.primary} />}
      footer={
        <View style={styles.actionsRow}>
          <View style={styles.actionBtn}>
            <Button
              secondary
              label={t('scheduleAssign.preview')}
              disabled={loading || !!loadError || command.isPending || previewPending}
              onPress={() => void showPreview()}
            />
          </View>
          <View style={styles.actionBtn}>
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
      }
    >
      <View pointerEvents={command.isPending ? 'none' : 'auto'} style={{ gap: 14 }}>
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

        {/* SECTION 1: TARGET */}
        <FormSection number="01" title={t('scheduleAssign.target')}>
          <CompactTabs
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
                  (teamWorkers.data ?? []).filter((w) => w.teamId === value).map((w) => w.workerId),
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
                      <View style={[styles.checkboxBox, isSelected && styles.checkboxBoxSelected]}>
                        {isSelected && <Text style={styles.checkmarkText}>✓</Text>}
                      </View>
                      <View style={styles.memberAvatar}>
                        <Text style={styles.avatarInitial}>
                          {(member.displayName || '?').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <Text
                        style={[styles.memberNameText, isSelected && styles.memberNameTextSelected]}
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
        </FormSection>

        {/* SECTION 2: SHIFT & TIME */}
        <FormSection number="02" title={t('schedule.time')}>
          <Choice
            label={t('schedule.shift')}
            value={shiftId}
            options={availableShifts.map((s) => ({
              value: s.id,
              label: `${s.name} (${shiftRange(s)}${shiftDayOffset(s) > 0 ? ` ${t('schedule.nextDay', { count: shiftDayOffset(s) })}` : ''})`,
            }))}
            onChange={(v) => update(() => setShiftId(v))}
          />

          <CompactTabs
            value={mode}
            options={[
              { value: 'DAY', label: t('scheduleAssign.day') },
              { value: 'WEEK', label: t('scheduleAssign.week') },
              { value: 'REPEAT', label: t('contractorUi.repeatMode') },
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
                  style={[styles.quickChipText, from === todayDate && styles.quickChipTextActive]}
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
            </View>

            <CalendarDateField
              label={mode === 'DAY' ? t('schedule.date') : t('schedule.fromDate')}
              value={from}
              onChange={(v) => update(() => setFrom(v))}
              disabled={command.isPending}
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
              </View>
              <CalendarDateField
                label={t('schedule.toDate')}
                value={to}
                onChange={(v) => update(() => setTo(v))}
                disabled={command.isPending}
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
                    <Text style={styles.weekdayQuickText}>
                      {t('schedule.weekday1')} – {t('schedule.weekday5')}
                    </Text>
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
                            old.includes(day) ? old.filter((d) => d !== day) : [...old, day].sort(),
                          ),
                        )
                      }
                      style={[styles.weekdayChip, isSelected && styles.weekdayChipSelected]}
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
        </FormSection>

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
      </View>
    </RequestSheet>
  );
}

const styles = StyleSheet.create({
  loadingBox: {
    padding: 12,
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  errorBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    padding: 12,
    borderRadius: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: colors.danger,
    fontWeight: '600',
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  membersContainer: {
    marginTop: 4,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: 10,
  },
  membersHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  membersHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  membersLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
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
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.primary,
  },
  membersList: {
    gap: 6,
  },
  memberRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  memberRowSelected: {
    backgroundColor: colors.primaryLight,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxBoxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmarkText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
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
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  memberNameTextSelected: {
    fontWeight: '700',
    color: colors.primary,
  },
  dateFieldWrapper: {
    gap: 8,
  },
  quickDateRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  quickChip: {
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  quickChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primaryBorder,
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  quickChipTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  hintCard: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#EFF6FF',
    padding: 10,
    borderRadius: 10,
  },
  hintIcon: {
    color: '#2563EB',
    fontWeight: '700',
  },
  hintText: {
    flex: 1,
    fontSize: 12,
    color: '#1D4ED8',
  },
  weekdaysWrapper: {
    gap: 8,
    marginTop: 4,
  },
  weekdaysHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekdaysLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  weekdaysQuickRow: {
    flexDirection: 'row',
    gap: 8,
  },
  weekdayQuickBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  weekdayQuickText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  weekdayChipsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  weekdayChip: {
    minHeight: 44,
    justifyContent: 'center',
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    alignItems: 'center',
  },
  weekdayChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  weekdayChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  weekdayChipTextSelected: {
    color: '#FFFFFF',
  },
  error: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '600',
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  previewHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  validBadge: {
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  validBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065F46',
  },
  conflictBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  conflictBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
  },
  previewMetricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricChip: {
    flex: 1,
    backgroundColor: colors.surface,
    padding: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  metricVal: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  metricLbl: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  conflictsBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  conflictsTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
  },
  conflictItem: {
    paddingVertical: 2,
  },
  conflictText: {
    fontSize: 12,
    color: '#B91C1C',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    marginBottom: 10,
  },
  actionBtn: {
    flex: 1,
  },
});
