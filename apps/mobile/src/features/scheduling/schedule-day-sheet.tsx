import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  ShiftResponse,
  TeamAttendanceMemberResponse,
  TeamAttendanceStatus,
  WorkerScheduleResponse,
} from '@smartsite/api-client';
import { IconCalendar, IconMapPin, IconUsers } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { RequestSheet } from '../shared/request-sheet';
import { Button, ErrorNotice, Field, Hint, QueryState } from '../shared/ui';
import { displayTime, useCommand, useRequestId } from '../shared/data';
import { useWorkspace } from '../workspace/workspace-context';
import { ScheduleDaySummary } from './schedule-day-summary';

export function RollCallBadge({ status }: { status: TeamAttendanceStatus }) {
  const { t } = useTranslation();
  const tone =
    status === 'PRESENT' ? styles.present : status === 'ABSENT' ? styles.absent : styles.waiting;
  return (
    <View style={[styles.badge, tone]}>
      <Text style={[styles.badgeText, tone]}>{t(`rollCall.${status}`)}</Text>
    </View>
  );
}

export function ScheduleDaySheet({
  schedule,
  shift,
  onClose,
  onRequest,
}: {
  schedule: WorkerScheduleResponse;
  shift?: ShiftResponse;
  onClose: () => void;
  onRequest: () => void;
}) {
  const { t } = useTranslation();
  const { scope, token, client, queryKey } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const [editingContext, setEditingContext] = useState<{ teamId: string; zoneId: string } | null>(
    null,
  );
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        scheduleId: string;
        expectedMembershipId: string;
        expectedVersion: number;
        status: 'PRESENT' | 'ABSENT';
      }
    >
  >({});
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);
  const [search, setSearch] = useState('');
  const command = useCommand(),
    requestId = useRequestId();
  const attendance = useQuery({
    queryKey: [...queryKey, 'zone-attendance', schedule.id],
    queryFn: () => client.scheduleTeamAttendance(token, scope.siteId, schedule.id),
    refetchInterval: 15000,
  });
  const entries = Object.values(drafts);
  const correcting = entries.some((e) => e.expectedVersion > 0);
  const data = attendance.data;
  const contextChanged =
    editing && (editingContext?.teamId !== data?.teamId || editingContext?.zoneId !== data?.zoneId);
  const busy = command.isPending;
  const reset = () => {
    setDrafts({});
    setReason('');
    setSearch('');
    command.reset();
  };
  const update = (member: TeamAttendanceMemberResponse, status: 'PRESENT' | 'ABSENT') => {
    if (!member.membershipId) return;
    setSaved(false);
    setDrafts((previous) => {
      const next = { ...previous };
      if (status === member.status && !previous[member.scheduleId]) return previous;
      next[member.scheduleId] = {
        scheduleId: member.scheduleId,
        expectedMembershipId:
          previous[member.scheduleId]?.expectedMembershipId ?? member.membershipId!,
        status,
        expectedVersion: previous[member.scheduleId]?.expectedVersion ?? member.version,
      };
      return next;
    });
  };
  return (
    <RequestSheet
      visible
      variant="compact"
      title={t('scheduleDay.title')}
      subtitle={scope.siteName}
      icon={<IconCalendar size={21} color={colors.primary} />}
      busy={busy}
      onClose={onClose}
      footer={
        editing ? (
          <View style={styles.footer}>
            <ErrorNotice error={command.error} />
            <Button
              label={t(
                busy ? 'rollCall.saving' : correcting ? 'rollCall.saveChanges' : 'rollCall.submit',
              )}
              disabled={
                busy ||
                !entries.length ||
                !data?.canSubmit ||
                attendance.isError ||
                contextChanged ||
                (correcting && reason.trim().length < 5)
              }
              onPress={() => {
                if (
                  !data?.canSubmit ||
                  !editingContext ||
                  contextChanged ||
                  !entries.length ||
                  busy
                )
                  return;
                const input = {
                  teamId: editingContext.teamId,
                  zoneId: editingContext.zoneId,
                  entries,
                  ...(correcting ? { reason: reason.trim() } : {}),
                };
                command.mutate(async () => {
                  await client.submitTeamAttendance(token, scope.siteId, schedule.id, {
                    ...input,
                    requestId: requestId(input),
                  });
                  await attendance.refetch();
                  setDrafts({});
                  setReason('');
                  setEditing(false);
                  setSaved(true);
                });
              }}
            />
            <Button
              secondary
              label={t('common.cancel')}
              disabled={busy}
              onPress={() => {
                reset();
                setEditing(false);
              }}
            />
          </View>
        ) : (
          <View style={styles.footer}>
            {data?.canManage && (
              <Button
                label={t(
                  data.members.some((m) => m.version > 0)
                    ? 'rollCall.updateAction'
                    : 'rollCall.action',
                )}
                disabled={!data.canSubmit || attendance.isError}
                onPress={() => {
                  if (!data.teamId || !data.zoneId) return;
                  reset();
                  setEditingContext({ teamId: data.teamId, zoneId: data.zoneId });
                  setSaved(false);
                  setEditing(true);
                }}
              />
            )}
            {schedule.isActive && (
              <Button secondary label={t('schedule.requestAction')} onPress={onRequest} />
            )}
          </View>
        )
      }
    >
      <ScheduleDaySummary workDate={schedule.workDate} shift={shift} />
      {!schedule.isActive && <Hint>{t('schedule.cancelledSchedule')}</Hint>}
      <QueryState query={attendance}>
        {(value) => (
          <>
            <View style={styles.attendanceCard}>
              <View style={styles.statusRow}>
                <Text style={styles.label}>{t('scheduleDay.zoneAttendance')}</Text>
                <RollCallBadge status={value.own.status} />
              </View>
              <Text style={styles.note}>
                {t(value.own.status === 'NOT_YET' ? 'scheduleDay.waiting' : 'scheduleDay.recorded')}
              </Text>
            </View>
            {(value.teamName || value.zoneName) && (
              <View style={styles.assignmentCard}>
                {value.teamName && (
                  <View style={styles.meta}>
                    <IconUsers size={16} color={colors.textMuted} />
                    <View style={styles.assignmentCopy}>
                      <Text style={styles.note}>{t('scheduleDay.group')}</Text>
                      <Text style={styles.metaText}>{value.teamName}</Text>
                    </View>
                  </View>
                )}
                {value.zoneName && (
                  <View style={styles.meta}>
                    <IconMapPin size={16} color={colors.textMuted} />
                    <View style={styles.assignmentCopy}>
                      <Text style={styles.note}>{t('scheduleDay.zone')}</Text>
                      <Text style={styles.metaText}>{value.zoneName}</Text>
                    </View>
                  </View>
                )}
              </View>
            )}
            {value.own.updatedAt && (
              <Text style={styles.note}>
                {t('rollCall.updatedAt', { time: displayTime(value.own.updatedAt) })}
              </Text>
            )}
            {contextChanged && <Hint>{t('rollCall.assignmentChanged')}</Hint>}
            {saved && (
              <Text accessibilityLiveRegion="polite" style={styles.success}>
                {t('rollCall.saved')}
              </Text>
            )}
            {value.own.gateCheck !== 'NOT_YET' && (
              <Text style={styles.note}>{t(`rollCall.gate${value.own.gateCheck}`)}</Text>
            )}
            {value.canManage && !value.canSubmit && (
              <Hint>{t(value.zoneId ? 'rollCall.readOnly' : 'rollCall.noZone')}</Hint>
            )}
            {editing && value.canManage && (
              <View style={styles.roster}>
                <View style={styles.meta}>
                  <IconUsers size={17} color={colors.primary} />
                  <Text style={styles.label}>
                    {t('rollCall.members', { count: value.members.length })}
                  </Text>
                </View>
                <Text style={styles.note}>{t('rollCall.selectHint')}</Text>
                {value.members.length > 8 && (
                  <Field
                    label={t('rollCall.search')}
                    value={search}
                    onChangeText={setSearch}
                    editable={!busy}
                  />
                )}
                {!value.members.length && <Hint>{t('rollCall.empty')}</Hint>}
                {value.members
                  .filter((m) =>
                    m.displayName.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                  )
                  .map((member) => (
                    <View key={member.scheduleId} style={styles.member}>
                      <View style={styles.memberHeader}>
                        <Text style={styles.name}>{member.displayName}</Text>
                        <RollCallBadge
                          status={drafts[member.scheduleId]?.status ?? member.status}
                        />
                      </View>
                      {member.locked ? (
                        <Text style={styles.note}>{t('rollCall.locked')}</Text>
                      ) : (
                        <View style={styles.options}>
                          {(['PRESENT', 'ABSENT'] as const).map((status) => (
                            <Pressable
                              key={status}
                              accessibilityRole="radio"
                              accessibilityLabel={t('rollCall.markMember', {
                                name: member.displayName,
                                status: t(`rollCall.${status}`),
                              })}
                              accessibilityState={{
                                checked:
                                  (drafts[member.scheduleId]?.status ?? member.status) === status,
                                disabled: busy || !value.canSubmit,
                              }}
                              disabled={busy || !value.canSubmit}
                              onPress={() => update(member, status)}
                              style={[
                                styles.option,
                                (drafts[member.scheduleId]?.status ?? member.status) === status &&
                                  styles.optionSelected,
                              ]}
                            >
                              <Text style={styles.optionText}>{t(`rollCall.${status}`)}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                      {member.gateCheck !== 'NOT_YET' && (
                        <Text style={styles.note}>{t(`rollCall.gate${member.gateCheck}`)}</Text>
                      )}
                    </View>
                  ))}
                {correcting && (
                  <Field
                    label={t('rollCall.reason')}
                    placeholder={t('rollCall.reasonHint')}
                    value={reason}
                    onChangeText={setReason}
                    editable={!busy}
                    maxLength={1000}
                  />
                )}
              </View>
            )}
          </>
        )}
      </QueryState>
    </RequestSheet>
  );
}

const styles = StyleSheet.create({
  attendanceCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: 7,
  },
  assignmentCard: { gap: 12, paddingVertical: 4 },
  assignmentCopy: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { flex: 1, fontSize: 13, lineHeight: 20, color: colors.textSecondary },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  label: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, lineHeight: 16, fontWeight: '700' },
  present: { backgroundColor: '#EAF7F0', color: '#177249' },
  absent: { backgroundColor: '#FDEFEF', color: '#B33939' },
  waiting: { backgroundColor: '#EEF1F5', color: '#64748B' },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  success: { color: '#177249', fontSize: 13, lineHeight: 20 },
  roster: { gap: 12, borderTopWidth: 1, borderColor: colors.borderLight, paddingTop: 16 },
  member: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: 14,
  },
  memberHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 20, fontWeight: '600' },
  options: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    backgroundColor: '#F6F7F9',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  optionText: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  footer: { gap: 8 },
});
