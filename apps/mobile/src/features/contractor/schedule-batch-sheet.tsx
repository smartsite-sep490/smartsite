import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  ChangeScheduleAssignmentCommand,
  ScheduleAssignmentBatchResponse,
} from '@smartsite/api-client';
import { ApiError } from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, localDate, required, useCommand, useRequestId } from '../shared/data';
import { Button, Choice, ErrorNotice, Field, Pager, QueryState } from '../shared/ui';
import { CalendarDateField } from '../shared/calendar-date-field';
import { RequestSheet } from '../shared/request-sheet';
import { ManagementBadge, ManagementLink } from '../shared/management-ui';
import { IconCalendar, IconClock, IconUsers } from '../../components/common/Icons';
import { uiLocale } from '../../i18n';
import { shiftRange } from '../scheduling/schedule-calendar';

function totals(batch: ScheduleAssignmentBatchResponse) {
  return batch.currentSchedules?.reduce(
    (sum, row) => ({
      active: sum.active + row.activeCount,
      cancelled: sum.cancelled + row.cancelledCount,
    }),
    { active: 0, cancelled: 0 },
  );
}

export function ScheduleBatchSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<{
    batch: ScheduleAssignmentBatchResponse;
    action: 'CANCEL' | 'CHANGE_SHIFT';
  } | null>(null);
  const [extent, setExtent] = useState<ChangeScheduleAssignmentCommand['scope']>('DAY');
  const [workDate, setWorkDate] = useState(localDate());
  const [shiftId, setShiftId] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const command = useCommand(),
    requestId = useRequestId();
  const conflict = command.error instanceof ApiError && command.error.status === 409;
  const batches = useQuery({
    queryKey: [...queryKey, 'schedule-batches', offset],
    queryFn: () =>
      client.listScheduleAssignments(token, scope.siteId, scope.contractorId, { offset, limit: 8 }),
  });
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) =>
      allPages((page) => client.listShifts(token, scope.siteId, page), signal),
  });
  const grants = useQuery({
    queryKey: [...queryKey, 'batch-shift-grants'],
    queryFn: ({ signal }) =>
      allPages((page) => client.listShiftContractorAssignments(token, scope.siteId, page), signal),
    enabled: selection?.action === 'CHANGE_SHIFT',
  });
  const choose = (batch: ScheduleAssignmentBatchResponse, action: 'CANCEL' | 'CHANGE_SHIFT') => {
    command.reset();
    setReason('');
    setShiftId('');
    setExtent('DAY');
    setNotice('');
    const dates = batch.currentSchedules
      ? [
          ...new Set(
            batch.currentSchedules.filter((row) => row.activeCount > 0).map((row) => row.workDate),
          ),
        ].sort()
      : batch.dates;
    setWorkDate(dates.find((date) => date >= localDate()) ?? dates[0] ?? batch.input.fromDate);
    setSelection({ batch, action });
  };
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat(uiLocale(), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T00:00:00Z`));
  const period = (from: string, to: string) =>
    from === to ? dateLabel(from) : `${dateLabel(from)} – ${dateLabel(to)}`;
  const shiftName = (id: string) =>
    shifts.data?.find((row) => row.id === id)?.name ?? t('schedule.shiftUnavailable');
  const affected = selection?.batch.currentSchedules?.filter(
    (row) =>
      row.activeCount > 0 &&
      (extent === 'UNSTARTED' ||
        (extent === 'DAY' ? row.workDate === workDate : row.workDate >= workDate)),
  );
  const currentShiftIds = new Set(
    affected?.map((row) => row.shiftId) ?? (selection ? [selection.batch.input.shiftId] : []),
  );
  const options = (shifts.data ?? []).filter(
    (shift) =>
      !shift.archivedAt &&
      !(currentShiftIds.size === 1 && currentShiftIds.has(shift.id)) &&
      grants.data?.some(
        (grant) => grant.contractorId === scope.contractorId && grant.shiftId === shift.id,
      ),
  );
  const badge = (batch: ScheduleAssignmentBatchResponse) => {
    const count = totals(batch);
    return count ? (
      <ManagementBadge
        label={t(
          count.active === 0
            ? 'scheduleManage.cancelled'
            : count.cancelled > 0
              ? 'scheduleManage.partial'
              : 'scheduleManage.active',
        )}
        tone={count.active === 0 ? 'neutral' : count.cancelled > 0 ? 'warning' : 'success'}
      />
    ) : null;
  };
  return (
    <RequestSheet
      visible
      variant="compact"
      title={t(
        selection
          ? selection.action === 'CANCEL'
            ? 'scheduleManage.cancel'
            : 'scheduleManage.change'
          : 'scheduleManage.open',
      )}
      subtitle={scope.siteName}
      icon={<IconCalendar size={21} color={colors.primary} />}
      onClose={onClose}
      busy={command.isPending}
      footer={
        selection ? (
          <View style={styles.actions}>
            <ErrorNotice error={command.error} />
            {conflict && (
              <Button
                secondary
                label={t('scheduleManage.reload')}
                disabled={batches.isFetching}
                onPress={() => {
                  void batches.refetch().then((result) => {
                    if (!result.isError) {
                      command.reset();
                      setSelection(null);
                    }
                  });
                }}
              />
            )}
            <View style={styles.footerRow}>
              <View style={styles.submit}>
                <Button
                  label={t(
                    selection.action === 'CANCEL' ? 'scheduleManage.confirmCancel' : 'common.save',
                  )}
                  disabled={
                    command.isPending ||
                    conflict ||
                    !reason.trim() ||
                    !workDate ||
                    (affected !== undefined && !affected.length) ||
                    (selection.action === 'CHANGE_SHIFT' &&
                      (!options.some((row) => row.id === shiftId) ||
                        !grants.isSuccess ||
                        !shifts.isSuccess))
                  }
                  onPress={() =>
                    command.mutate(async () => {
                      const input = {
                        expectedVersion: selection.batch.version,
                        action: selection.action,
                        scope: extent,
                        workDate,
                        ...(selection.action === 'CHANGE_SHIFT' ? { shiftId } : {}),
                        reason: required(reason, t('scheduleManage.reason')),
                      };
                      const result = await client.changeScheduleAssignment(
                        token,
                        scope.siteId,
                        selection.batch.id,
                        {
                          ...input,
                          requestId: requestId({
                            siteId: scope.siteId,
                            batchId: selection.batch.id,
                            ...input,
                          }),
                        },
                      );
                      await batches.refetch();
                      setNotice(
                        result.changedCount === undefined
                          ? t('scheduleManage.saved')
                          : t('scheduleManage.result', {
                              changed: result.changedCount,
                              skipped: result.skippedCount ?? 0,
                            }),
                      );
                      setSelection(null);
                    })
                  }
                />
              </View>
              <View style={styles.back}>
                <Button
                  secondary
                  label={t('common.back')}
                  disabled={command.isPending}
                  onPress={() => {
                    command.reset();
                    setSelection(null);
                  }}
                />
              </View>
            </View>
          </View>
        ) : null
      }
    >
      {notice && (
        <Text accessibilityLiveRegion="polite" style={styles.success}>
          {notice}
        </Text>
      )}
      {selection ? (
        <>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>{t('scheduleManage.selectedBatch')}</Text>
            <View style={styles.heading}>
              <Text style={styles.name}>{selection.batch.targetName}</Text>
              {badge(selection.batch)}
            </View>
            <Text style={styles.hint}>
              {period(selection.batch.input.fromDate, selection.batch.input.toDate)}
            </Text>
            <Text style={styles.value}>
              {[...currentShiftIds].map(shiftName).join(' · ') || t('scheduleManage.noMatch')}
            </Text>
          </View>
          <Choice
            label={t('scheduleManage.scope')}
            value={extent}
            disabled={command.isPending}
            onChange={(value) => {
              setExtent(value as typeof extent);
              setShiftId('');
            }}
            options={(['DAY', 'FROM_DATE', 'UNSTARTED'] as const).map((value) => ({
              value,
              label: t(`scheduleManage.${value}`),
            }))}
          />
          {extent !== 'UNSTARTED' && (
            <CalendarDateField
              label={t('scheduleManage.date')}
              value={workDate}
              disabled={command.isPending}
              onChange={(value) => {
                setWorkDate(value);
                setShiftId('');
              }}
            />
          )}
          {affected !== undefined && !affected.length && (
            <Text accessibilityRole="alert" style={styles.warning}>
              {t('scheduleManage.noMatch')}
            </Text>
          )}
          {selection.action === 'CHANGE_SHIFT' && (
            <QueryState query={shifts}>
              {() => (
                <QueryState query={grants}>
                  {() => (
                    <>
                      <Choice
                        label={t('schedule.shift')}
                        value={shiftId}
                        onChange={setShiftId}
                        disabled={command.isPending}
                        options={options.map((shift) => ({ value: shift.id, label: shift.name }))}
                      />
                      {!!shiftId && options.some((row) => row.id === shiftId) && (
                        <Text style={styles.hint}>
                          {shiftRange(options.find((row) => row.id === shiftId)!)}
                        </Text>
                      )}
                      {!options.length && (
                        <Text style={styles.warning}>{t('scheduleManage.noShifts')}</Text>
                      )}
                    </>
                  )}
                </QueryState>
              )}
            </QueryState>
          )}
          <Field
            multiline
            maxLength={1000}
            placeholder={t('scheduleManage.reasonPlaceholder')}
            label={t('scheduleManage.reason')}
            value={reason}
            onChangeText={setReason}
            editable={!command.isPending}
          />
          <View style={styles.info}>
            <Text style={styles.hint}>{t('scheduleManage.startedHint')}</Text>
          </View>
        </>
      ) : (
        <QueryState query={batches}>
          {(data) => (
            <>
              <Text style={styles.hint}>{t('scheduleManage.hint')}</Text>
              <ManagementLink
                label={t('scheduleManage.reload')}
                disabled={batches.isFetching}
                onPress={() => {
                  void batches.refetch();
                }}
              />
              {!data.items.length && <Text style={styles.hint}>{t('scheduleManage.empty')}</Text>}
              {data.items.map((batch) => {
                const count = totals(batch);
                const groups = new Map<string, { active: number; cancelled: number }>();
                for (const row of batch.currentSchedules ?? []) {
                  const group = groups.get(row.shiftId) ?? { active: 0, cancelled: 0 };
                  group.active += row.activeCount;
                  group.cancelled += row.cancelledCount;
                  groups.set(row.shiftId, group);
                }
                return (
                  <View key={batch.id} style={styles.card}>
                    <View style={styles.heading}>
                      <View style={styles.teamIcon}>
                        <IconUsers size={18} color={colors.primary} />
                      </View>
                      <Text style={styles.name}>{batch.targetName}</Text>
                      {badge(batch)}
                    </View>
                    <Text style={styles.hint}>
                      {period(batch.input.fromDate, batch.input.toDate)}
                    </Text>
                    {count ? (
                      <>
                        <View style={styles.metrics}>
                          <Text style={styles.value}>
                            {t('scheduleManage.activeCount', { count: count.active })}
                          </Text>
                          {count.cancelled > 0 && (
                            <Text style={styles.hint}>
                              {t('scheduleManage.cancelledCount', { count: count.cancelled })}
                            </Text>
                          )}
                        </View>
                        {[...groups].map(([id, group]) => (
                          <View key={id} style={styles.shiftRow}>
                            <IconClock
                              size={15}
                              color={group.active > 0 ? colors.primary : colors.textTertiary}
                            />
                            <Text style={[styles.value, styles.copy]}>{shiftName(id)}</Text>
                            <Text style={styles.hint}>
                              {t(
                                group.active > 0
                                  ? 'scheduleManage.activeCount'
                                  : 'scheduleManage.cancelledCount',
                                { count: group.active || group.cancelled },
                              )}
                            </Text>
                          </View>
                        ))}
                        {(batch.currentSchedules?.length ?? 0) > 1 && (
                          <>
                            <ManagementLink
                              label={t(
                                expanded === batch.id
                                  ? 'scheduleManage.hideDates'
                                  : 'scheduleManage.showDates',
                              )}
                              onPress={() => setExpanded(expanded === batch.id ? null : batch.id)}
                            />
                            {expanded === batch.id && (
                              <View style={styles.dates}>
                                {batch.currentSchedules!.map((row) => (
                                  <View
                                    key={`${row.workDate}:${row.shiftId}`}
                                    style={styles.dateDetail}
                                  >
                                    <Text style={styles.value}>{dateLabel(row.workDate)}</Text>
                                    <Text style={styles.hint}>{shiftName(row.shiftId)}</Text>
                                    <Text style={styles.hint}>
                                      {t('scheduleManage.activeCount', { count: row.activeCount })}
                                      {row.cancelledCount > 0
                                        ? ` · ${t('scheduleManage.cancelledCount', { count: row.cancelledCount })}`
                                        : ''}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <View style={styles.info}>
                        <Text style={styles.eyebrow}>{t('scheduleManage.original')}</Text>
                        <Text style={styles.value}>{shiftName(batch.input.shiftId)}</Text>
                        <Text style={styles.hint}>{t('scheduleManage.liveUnavailable')}</Text>
                      </View>
                    )}
                    {(!count || count.active > 0) && (
                      <View style={styles.cardActions}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('scheduleManage.change')}
                          style={[styles.cardAction, styles.changeAction]}
                          onPress={() => choose(batch, 'CHANGE_SHIFT')}
                        >
                          <Text style={styles.changeText}>{t('scheduleManage.change')}</Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('scheduleManage.cancel')}
                          style={styles.cardAction}
                          onPress={() => choose(batch, 'CANCEL')}
                        >
                          <Text style={styles.cancelText}>{t('scheduleManage.cancel')}</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              })}
              {data.total > 8 && (
                <Pager offset={offset} total={data.total} size={8} onChange={setOffset} />
              )}
            </>
          )}
        </QueryState>
      )}
    </RequestSheet>
  );
}
const styles = StyleSheet.create({
  actions: { gap: 8 },
  footerRow: { flexDirection: 'row', gap: 10 },
  submit: { flex: 2 },
  back: { flex: 1 },
  card: {
    gap: 12,
    padding: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  heading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  copy: { flex: 1, minWidth: 0 },
  teamIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  value: { fontSize: 13, lineHeight: 21, fontWeight: '600', color: colors.textPrimary },
  eyebrow: { fontSize: 10, lineHeight: 17, fontWeight: '700', color: colors.textMuted },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  shiftRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  cardActions: { flexDirection: 'row', gap: 9, paddingTop: 2 },
  cardAction: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: colors.surfaceSubtle,
  },
  changeAction: { backgroundColor: colors.primaryLight },
  changeText: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  cancelText: {
    color: colors.dangerText,
    fontSize: 12,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'center',
  },
  dates: { borderTopWidth: 1, borderTopColor: colors.borderLight, gap: 10, paddingTop: 10 },
  dateDetail: { gap: 2 },
  info: { backgroundColor: colors.surfaceSubtle, borderRadius: 12, padding: 12, gap: 4 },
  warning: { fontSize: 12, lineHeight: 19, color: colors.warningText },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  success: {
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 20,
    color: colors.successText,
    backgroundColor: colors.successBg,
  },
});
