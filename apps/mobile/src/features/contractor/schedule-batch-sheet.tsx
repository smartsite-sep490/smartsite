import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type {
  ChangeScheduleAssignmentCommand,
  ScheduleAssignmentBatchResponse,
} from '@smartsite/api-client';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, localDate, required, useCommand, useRequestId } from '../shared/data';
import { Button, Choice, ErrorNotice, Field, Pager, QueryState } from '../shared/ui';
import { CalendarDateField } from '../shared/calendar-date-field';
import { RequestSheet } from '../shared/request-sheet';

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
  const command = useCommand(),
    requestId = useRequestId();
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
    setWorkDate(batch.dates.find((date) => date >= localDate()) ?? batch.input.fromDate);
    setSelection({ batch, action });
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
          : 'scheduleManage.title',
      )}
      onClose={onClose}
      busy={command.isPending}
      footer={
        selection ? (
          <View style={styles.actions}>
            <ErrorNotice error={command.error} />
            <Button
              label={t(
                selection.action === 'CANCEL' ? 'scheduleManage.confirmCancel' : 'common.save',
              )}
              disabled={
                command.isPending ||
                !reason.trim() ||
                !workDate ||
                (selection.action === 'CHANGE_SHIFT' &&
                  (!shiftId || !grants.isSuccess || !shifts.isSuccess))
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
                    { ...input, requestId: requestId(input) },
                  );
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
            <Text style={styles.name}>{selection.batch.targetName}</Text>
            <Text style={styles.hint}>
              {selection.batch.input.fromDate} – {selection.batch.input.toDate}
            </Text>
          </View>
          <Text style={styles.hint}>{t('scheduleManage.startedHint')}</Text>
          <Choice
            label={t('scheduleManage.scope')}
            value={extent}
            onChange={(value) => setExtent(value as typeof extent)}
            options={(['DAY', 'FROM_DATE', 'UNSTARTED'] as const).map((value) => ({
              value,
              label: t(`scheduleManage.${value}`),
            }))}
          />
          {extent !== 'UNSTARTED' && (
            <CalendarDateField
              label={t('scheduleManage.date')}
              value={workDate}
              onChange={setWorkDate}
            />
          )}
          {selection.action === 'CHANGE_SHIFT' && (
            <QueryState query={shifts}>
              {(rows) => (
                <QueryState query={grants}>
                  {(allowed) => (
                    <Choice
                      label={t('schedule.shift')}
                      value={shiftId}
                      onChange={setShiftId}
                      options={rows
                        .filter(
                          (shift) =>
                            !shift.archivedAt &&
                            shift.id !== selection.batch.input.shiftId &&
                            allowed.some(
                              (grant) =>
                                grant.contractorId === scope.contractorId &&
                                grant.shiftId === shift.id,
                            ),
                        )
                        .map((shift) => ({ value: shift.id, label: shift.name }))}
                    />
                  )}
                </QueryState>
              )}
            </QueryState>
          )}
          <Field
            multiline
            label={t('scheduleManage.reason')}
            value={reason}
            onChangeText={setReason}
            editable={!command.isPending}
          />
        </>
      ) : (
        <QueryState query={batches}>
          {(data) => (
            <>
              <Text style={styles.hint}>{t('scheduleManage.hint')}</Text>
              {!data.items.length && <Text style={styles.hint}>{t('scheduleManage.empty')}</Text>}
              {data.items.map((batch) => (
                <View key={batch.id} style={styles.card}>
                  <Text style={styles.name}>{batch.targetName}</Text>
                  <Text style={styles.hint}>
                    {shifts.data?.find((shift) => shift.id === batch.input.shiftId)?.name ??
                      t('schedule.shiftUnavailable')}
                  </Text>
                  <Text style={styles.hint}>
                    {batch.input.fromDate} – {batch.input.toDate}
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      secondary
                      label={t('scheduleManage.change')}
                      onPress={() => choose(batch, 'CHANGE_SHIFT')}
                    />
                    <Button
                      secondary
                      label={t('scheduleManage.cancel')}
                      onPress={() => choose(batch, 'CANCEL')}
                    />
                  </View>
                </View>
              ))}
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
  card: {
    gap: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
  },
  name: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
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
