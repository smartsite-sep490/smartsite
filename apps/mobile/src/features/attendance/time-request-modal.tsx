import { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  LEAVE_NOTICE_HOURS,
  scheduledShiftWindow,
  type LeaveNoticeType,
} from '@smartsite/api-client';
import { useTranslation, translate as tr } from '../../i18n';
import { useWorkspace } from '../workspace/workspace-context';
import {
  allPages,
  minutes,
  instant,
  localDate,
  required,
  useCommand,
  useRequestId,
} from '../shared/data';
import { Choice, ErrorNotice, Field, Hint, QueryState } from '../shared/ui';
import { DateTimeField } from '../shared/date-time-field';
import { colors } from '../../theme/colors';
import { RequestSheet } from '../shared/request-sheet';
import { FormSection } from '../shared/form-section';
import { IconCalendar, IconClock, IconChevronRight } from '../../components/common/Icons';

interface TimeRequestModalProps {
  visible: boolean;
  onClose: () => void;
  onBehalfWorkerId?: string;
  initialKind?: 'LEAVE' | 'OVERTIME';
  onSubmitted?: () => void;
}

export function TimeRequestModal(props: TimeRequestModalProps) {
  return props.visible ? (
    <TimeRequestForm
      key={`${props.onBehalfWorkerId ?? 'self'}:${props.initialKind ?? 'LEAVE'}`}
      {...props}
    />
  ) : null;
}

function TimeRequestForm({
  visible,
  onClose,
  onBehalfWorkerId,
  initialKind = 'LEAVE',
  onSubmitted,
}: TimeRequestModalProps) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey, workerId } = useWorkspace();
  const requestedWorkerId = onBehalfWorkerId ?? workerId;
  const [openedAt] = useState(() => Date.now());
  const [noticeType, setNoticeType] = useState<LeaveNoticeType>('PLANNED');
  const [kind, setKind] = useState<'LEAVE' | 'OVERTIME'>(onBehalfWorkerId ? 'LEAVE' : initialKind),
    [scheduleId, setSchedule] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [reason, setReason] = useState('');
  const command = useCommand(),
    requestId = useRequestId();

  const schedules = useQuery({
    queryKey: [...queryKey, 'request-schedules', requestedWorkerId],
    queryFn: ({ signal }) =>
      allPages(
        (p) =>
          client.listWorkerSchedules(token, scope.siteId, {
            ...p,
            status: 'ACTIVE',
            workerId: requestedWorkerId,
          }),
        signal,
      ),
    enabled: visible && !!requestedWorkerId,
  });

  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) => allPages((p) => client.listShifts(token, scope.siteId, p), signal),
    enabled: visible && !!requestedWorkerId,
  });

  const availableSchedules = (schedules.data ?? [])
    .filter((s) => {
      if (s.workerId !== requestedWorkerId || !s.isActive) return false;
      if (kind === 'LEAVE') return true;
      const shift = shifts.data?.find((v) => v.id === s.shiftId);
      if (!shift) return false;
      try {
        const window = scheduledShiftWindow(
          {
            startsAt: new Date(shift.startsAt),
            endsAt: new Date(shift.endsAt),
            timezone: shift.timezone,
          },
          s.workDate,
        );
        return (
          localDate(new Date(Math.max(+window.endsAt, openedAt + 60000)), shift.timezone) ===
          localDate(window.endsAt, shift.timezone)
        );
      } catch {
        return false;
      }
    })
    .map((s) => ({
      value: s.id,
      label: `${s.workDate} · ${shifts.data?.find((v) => v.id === s.shiftId)?.name ?? tr('schedule.shift')}`,
    }));

  const canSubmit =
    !command.isPending &&
    !!scheduleId &&
    !!from &&
    !!to &&
    reason.trim().length >= 5 &&
    schedules.isSuccess &&
    shifts.isSuccess &&
    !schedules.isRefetchError &&
    !shifts.isRefetchError;
  const duration =
    from && to && Date.parse(to) > Date.parse(from)
      ? minutes(Math.round((Date.parse(to) - Date.parse(from)) / 60000))
      : null;

  return (
    <RequestSheet
      variant="form"
      icon={
        kind === 'LEAVE' ? (
          <IconCalendar size={23} color={colors.primary} />
        ) : (
          <IconClock size={23} color={colors.primary} />
        )
      }
      visible={visible}
      onClose={onClose}
      busy={command.isPending}
      title={
        onBehalfWorkerId
          ? t('leavePolicy.recordOnBehalf')
          : t(kind === 'LEAVE' ? 'attendanceUi.leaveAction' : 'attendanceUi.overtimeAction')
      }
      subtitle={t(
        kind === 'LEAVE' ? 'attendanceUi.leaveFormHint' : 'attendanceUi.overtimeFormHint',
      )}
      footer={
        <View style={styles.footer}>
          <ErrorNotice error={command.error} />
          {duration && (
            <View style={styles.durationRow}>
              <IconClock size={17} color={colors.primary} />
              <Text style={styles.durationLabel}>{t('attendanceUi.totalDuration')}</Text>
              <Text style={styles.durationValue}>{duration}</Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('leavePolicy.submit')}
            accessibilityState={{ disabled: !canSubmit, busy: command.isPending }}
            disabled={!canSubmit}
            style={({ pressed }) => [
              styles.submit,
              !canSubmit && styles.submitDisabled,
              pressed && styles.pressed,
            ]}
            onPress={() =>
              command.mutate(async () => {
                const startsAt = instant(from),
                  endsAt = instant(to);
                if (endsAt <= startsAt) throw new Error(tr('validation.timeEndAfterStart'));
                if (kind === 'OVERTIME' && Date.parse(startsAt) <= Date.now())
                  throw new Error(tr('validation.overtimeBeforeStart'));
                const selected = schedules.data?.find((s) => s.id === scheduleId);
                if (!selected || selected.workerId !== requestedWorkerId || !selected.isActive)
                  throw new Error(tr('requests.outOfScope'));
                const input = {
                  workerScheduleId: scheduleId,
                  kind,
                  startsAt,
                  endsAt,
                  reason: required(reason, tr('validation.reasonLabel')),
                  ...(kind === 'LEAVE' ? { noticeType } : {}),
                };
                await client.requestAttendanceTime(token, scope.siteId, {
                  ...input,
                  requestId: requestId(input),
                });
                setSchedule('');
                setFrom('');
                setTo('');
                setReason('');
                onSubmitted?.();
                onClose();
              })
            }
          >
            {command.isPending && <ActivityIndicator size="small" color={colors.textWhite} />}
            <Text style={styles.submitText}>
              {t(command.isPending ? 'requests.sending' : 'leavePolicy.submit')}
            </Text>
            {!command.isPending && <IconChevronRight size={18} color={colors.textWhite} />}
          </Pressable>
          <Text style={styles.footerHint}>{t('attendanceUi.reviewHint')}</Text>
        </View>
      }
    >
      <View pointerEvents={command.isPending ? 'none' : 'auto'} style={styles.form}>
        {!onBehalfWorkerId && (
          <View style={styles.kindTabs}>
            {(['LEAVE', 'OVERTIME'] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={t(
                  value === 'LEAVE' ? 'attendance.partialLeave' : 'attendance.overtimeOutsideShift',
                )}
                accessibilityState={{ checked: kind === value, disabled: command.isPending }}
                disabled={command.isPending}
                onPress={() => {
                  if (value === kind) return;
                  setKind(value);
                  setSchedule('');
                  setFrom('');
                  setTo('');
                  command.reset();
                }}
                style={({ pressed }) => [
                  styles.kindTab,
                  kind === value && styles.kindSelected,
                  pressed && styles.pressed,
                ]}
              >
                {value === 'LEAVE' ? (
                  <IconCalendar
                    size={18}
                    color={kind === value ? colors.primary : colors.textMuted}
                  />
                ) : (
                  <IconClock size={18} color={kind === value ? colors.primary : colors.textMuted} />
                )}
                <Text style={[styles.kindText, kind === value && styles.kindSelectedText]}>
                  {t(
                    value === 'LEAVE' ? 'attendanceUi.leaveAction' : 'attendanceUi.overtimeAction',
                  )}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <FormSection number="01" title={t('attendanceUi.chooseSchedule')}>
          <QueryState query={shifts}>
            {() => (
              <QueryState query={schedules}>
                {() => (
                  <>
                    <Choice
                      disabled={command.isPending}
                      label={tr('attendance.assignedShift')}
                      value={scheduleId}
                      onChange={(id) => {
                        setSchedule(id);
                        command.reset();
                        const schedule = schedules.data?.find(
                          (s) => s.id === id && s.workerId === requestedWorkerId,
                        );
                        const shift = shifts.data?.find((v) => v.id === schedule?.shiftId);
                        if (!schedule || !shift) {
                          setFrom('');
                          setTo('');
                          return;
                        }
                        try {
                          const window = scheduledShiftWindow(
                            {
                              startsAt: new Date(shift.startsAt),
                              endsAt: new Date(shift.endsAt),
                              timezone: shift.timezone,
                            },
                            schedule.workDate,
                          );
                          const now = Date.now();
                          const start =
                            kind === 'OVERTIME'
                              ? Math.max(+window.endsAt, now + 60000)
                              : now > +window.startsAt && now < +window.endsAt
                                ? now
                                : +window.startsAt;
                          setFrom(new Date(start).toISOString());
                          setTo(
                            kind === 'OVERTIME'
                              ? new Date(start + 3600000).toISOString()
                              : window.endsAt.toISOString(),
                          );
                        } catch {
                          setFrom('');
                          setTo('');
                        }
                      }}
                      options={availableSchedules}
                    />
                    {!availableSchedules.length && <Hint>{t('attendanceUi.noSchedules')}</Hint>}
                  </>
                )}
              </QueryState>
            )}
          </QueryState>
        </FormSection>

        <FormSection number="02" title={t('attendanceUi.chooseTime')}>
          {kind === 'LEAVE' && (
            <View style={styles.noticeGroup}>
              <Text style={styles.fieldLabel}>{t('leavePolicy.noticeType')}</Text>
              <View style={styles.noticeOptions}>
                {(['PLANNED', 'EMERGENCY'] as const).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={t(
                      value === 'PLANNED' ? 'leavePolicy.planned' : 'leavePolicy.emergency',
                    )}
                    accessibilityState={{
                      checked: noticeType === value,
                      disabled: command.isPending,
                    }}
                    disabled={command.isPending}
                    onPress={() => setNoticeType(value)}
                    style={({ pressed }) => [
                      styles.noticeOption,
                      noticeType === value && styles.noticeSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.radio, noticeType === value && styles.radioSelected]}>
                      {noticeType === value && <View style={styles.radioDot} />}
                    </View>
                    <Text
                      style={[styles.noticeText, noticeType === value && styles.kindSelectedText]}
                    >
                      {t(value === 'PLANNED' ? 'leavePolicy.planned' : 'leavePolicy.emergency')}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.help}>
                {t('leavePolicy.noticeHint', { hours: LEAVE_NOTICE_HOURS })}
              </Text>
              {noticeType === 'EMERGENCY' && (
                <Text style={styles.help}>{t('leavePolicy.emergencyHint')}</Text>
              )}
            </View>
          )}
          {onBehalfWorkerId && <Hint>{t('leavePolicy.onBehalfHint')}</Hint>}
          {scheduleId && (
            <Text style={styles.timezone}>
              {
                shifts.data?.find(
                  (v) => v.id === schedules.data?.find((s) => s.id === scheduleId)?.shiftId,
                )?.timezone
              }
            </Text>
          )}
          {scheduleId ? (
            <>
              <DateTimeField
                compact
                disabled={command.isPending}
                label={tr('common.start')}
                value={from}
                onChange={setFrom}
              />
              <DateTimeField
                compact
                disabled={command.isPending}
                label={tr('common.end')}
                value={to}
                onChange={setTo}
              />
              <Text style={styles.help}>
                {kind === 'LEAVE'
                  ? tr('attendance.leaveBoundsHint')
                  : tr('attendance.overtimeBoundsHint')}
              </Text>
            </>
          ) : (
            <View style={styles.emptyTime}>
              <IconClock size={22} color={colors.textMuted} />
              <Text style={styles.emptyTimeText}>{t('attendanceUi.selectScheduleFirst')}</Text>
            </View>
          )}
        </FormSection>
        <FormSection number="03" title={t('attendanceUi.reasonTitle')}>
          <Field
            editable={!command.isPending}
            style={styles.reasonInput}
            maxLength={1000}
            placeholder={t(
              kind === 'LEAVE' ? 'attendanceUi.leaveReasonHint' : 'attendanceUi.overtimeReasonHint',
            )}
            label={tr('requests.reason')}
            value={reason}
            onChangeText={setReason}
            multiline
          />

          <View style={styles.reasonHelp}>
            <Text style={styles.reasonMinimum}>{t('attendanceUi.reasonMinimum')}</Text>
            <Text style={styles.counter}>{reason.length}/1000</Text>
          </View>
        </FormSection>
      </View>
    </RequestSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  kindTabs: {
    flexDirection: 'row',
    gap: 6,
    borderRadius: 14,
    padding: 5,
    backgroundColor: '#EDEFF3',
  },
  kindTab: {
    flex: 1,
    minHeight: 48,
    padding: 10,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  kindSelected: { backgroundColor: colors.surface },
  kindText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
    color: colors.textMuted,
    flexShrink: 1,
  },
  kindSelectedText: { color: colors.primaryHover },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, lineHeight: 18 },
  noticeGroup: { gap: 10 },
  noticeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  noticeOption: {
    flex: 1,
    minWidth: 110,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    gap: 10,
  },
  noticeSelected: { backgroundColor: colors.primaryLight, borderColor: colors.primaryBorder },
  noticeText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', lineHeight: 20 },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  help: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  timezone: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  emptyTime: {
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: colors.surfaceSubtle,
  },
  emptyTimeText: { textAlign: 'center', color: colors.textMuted, fontSize: 12, lineHeight: 20 },
  reasonInput: {
    backgroundColor: colors.surfaceSubtle,
    minHeight: 112,
    fontSize: 14,
    lineHeight: 22,
  },
  reasonHelp: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  reasonMinimum: { flex: 1, color: colors.textMuted, fontSize: 11, lineHeight: 18 },
  counter: { color: colors.textMuted, fontSize: 11, lineHeight: 18 },
  footer: { gap: 10 },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  durationLabel: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  durationValue: { color: colors.primary, fontSize: 16, fontWeight: '800' },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 14,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  submitDisabled: { backgroundColor: '#F6BCA8' },
  submitText: {
    flexShrink: 1,
    color: colors.textWhite,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
    textAlign: 'center',
  },
  pressed: { opacity: 0.7 },
  footerHint: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.textMuted,
    marginBottom: 2,
  },
});
