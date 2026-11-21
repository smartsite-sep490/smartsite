import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ShiftRequestResponse } from '@smartsite/api-client';
import { IconChevronRight, IconSwap } from '../../components/common/Icons';
import { useTranslation } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { colors } from '../../theme/colors';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, displayShiftTime, displayTime, useCommand } from '../shared/data';
import {
  Button,
  CompactTabs,
  ErrorNotice,
  Field,
  Hint,
  Page,
  Pager,
  QueryState,
} from '../shared/ui';
import { ManagementBadge } from '../shared/management-ui';
import { RequestSheet } from '../shared/request-sheet';
import { EmptyState } from '../contractor/contractor-presentation';
import { formatRequestDate } from './request-date';
import { WorkerRequestHistory } from './worker-request-history';

type Swap = Extract<ShiftRequestResponse, { requestType: 'SWAP' }>;

export function WorkerRequestsScreen({
  initialId,
  initialView,
  onBack,
}: {
  initialId?: string;
  initialView?: 'INCOMING';
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'WORKER' | 'INCOMING'>(initialView ?? 'WORKER');
  return (
    <Page title={t('workerRequests.sentTitle')} onBack={onBack}>
      <CompactTabs
        value={view}
        options={[
          { value: 'WORKER', label: t('workerRequests.sentTab') },
          { value: 'INCOMING', label: t('workerRequests.incomingTab') },
        ]}
        onChange={(value) => setView(value as typeof view)}
      />
      {view === 'WORKER' ? (
        <WorkerRequestHistory initialId={initialView === 'INCOMING' ? undefined : initialId} />
      ) : (
        <WorkerIncomingRequests initialId={initialView === 'INCOMING' ? initialId : undefined} />
      )}
    </Page>
  );
}

function WorkerIncomingRequests({ initialId }: { initialId?: string }) {
  const { t } = useTranslation();
  const { client, scope, token, queryKey, workerId, user } = useWorkspace();
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState(initialId);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const command = useCommand();
  const size = 10;
  const recipient = (row: Swap) =>
    row.siteId === scope.siteId &&
    row.coworkerWorkerId === workerId &&
    row.requestedByUserId !== user.id;
  const query = useQuery({
    queryKey: [...queryKey, 'worker-incoming-swaps', workerId, offset],
    enabled: !!workerId,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const rows = (
        await allPages(
          (page) =>
            client.listShiftRequests(token, scope.siteId, {
              ...page,
              view: 'INCOMING',
              requestType: 'SWAP',
            }),
          signal,
        )
      ).filter(
        (row): row is Swap =>
          row.requestType === 'SWAP' && recipient(row) && row.status === 'PENDING_COWORKER',
      );
      return { items: rows.slice(offset, offset + size), total: rows.length };
    },
  });
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) =>
      allPages((page) => client.listShifts(token, scope.siteId, page), signal),
  });
  const selected = useQuery({
    queryKey: [...queryKey, 'worker-incoming-swap-detail', selectedId],
    enabled: !!selectedId && !!workerId,
    refetchInterval: 15000,
    queryFn: async (): Promise<Swap> => ({
      ...(await client.getShiftSwapRequest(token, scope.siteId, selectedId!)),
      requestType: 'SWAP',
    }),
  });
  const detail = selectedId ? selected.data : undefined;
  const canRespond = !!detail && recipient(detail) && detail.status === 'PENDING_COWORKER';
  const knownShifts =
    !!detail &&
    !!detail.coworkerWorkDate &&
    !!detail.requesterWorkDate &&
    [detail.coworkerShiftId, detail.requesterShiftId].every((id) =>
      shifts.data?.some((shift) => shift.id === id),
    );
  const close = () => {
    setSelectedId(undefined);
    setReason('');
    command.reset();
  };
  const respond = (agree: boolean) => {
    if (
      !detail ||
      !canRespond ||
      selected.isRefetchError ||
      (agree && (!knownShifts || shifts.isRefetchError))
    )
      return;
    if (!agree && reason.trim().length < 5) return;
    command.mutate(async () => {
      if (agree) await client.confirmShiftSwapRequest(token, scope.siteId, detail.id);
      else
        await client.declineShiftSwapRequest(token, scope.siteId, detail.id, {
          reason: reason.trim(),
        });
      setNotice(t(agree ? 'workerRequests.swapConfirmed' : 'workerRequests.swapDeclined'));
      setSelectedId(undefined);
      setReason('');
    });
  };
  const shiftCard = (title: string, id: string, date?: string | null) => {
    const shift = shifts.data?.find((value) => value.id === id);
    return (
      <View style={styles.shiftCard}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.shiftName}>{shift?.name ?? t('common.notRecorded')}</Text>
        <Text style={styles.meta}>{formatRequestDate(date)}</Text>
        {shift && (
          <Text style={styles.meta}>
            {displayShiftTime(shift.startsAt)} – {displayShiftTime(shift.endsAt)}
          </Text>
        )}
      </View>
    );
  };
  if (!workerId) return <Hint>{t('requests.outOfScope')}</Hint>;
  return (
    <>
      {!!notice && (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          {notice}
        </Text>
      )}
      <QueryState query={query}>
        {(data) => (
          <>
            {!data.items.length ? (
              <EmptyState
                icon={<IconSwap size={24} color={colors.textMuted} />}
                title={t('workerRequests.incomingEmpty')}
                hint={t('workerRequests.incomingEmptyHint')}
              />
            ) : (
              <>
                <Text style={styles.caption}>
                  {t('workerRequests.needsResponse', { count: data.total })}
                </Text>
                <View style={styles.list}>
                  {data.items.map((row, index) => (
                    <Pressable
                      key={row.id}
                      accessibilityRole="button"
                      accessibilityLabel={t('requests.viewRequest')}
                      accessibilityHint={`${t('workerRequests.incomingSwap')}, ${formatRequestDate(row.coworkerWorkDate)}`}
                      onPress={() => {
                        command.reset();
                        setReason('');
                        setSelectedId(row.id);
                      }}
                      style={({ pressed }) => [
                        styles.row,
                        index > 0 && styles.divider,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.icon}>
                        <IconSwap size={19} color={colors.primary} />
                      </View>
                      <View style={styles.copy}>
                        <Text style={styles.title}>{t('workerRequests.incomingSwap')}</Text>
                        <View style={styles.rowMeta}>
                          <Text style={styles.date}>{formatRequestDate(row.coworkerWorkDate)}</Text>
                          <ManagementBadge label={t('workerRequests.incomingTab')} tone="warning" />
                        </View>
                        <Text numberOfLines={1} style={styles.meta}>
                          {row.reason}
                        </Text>
                      </View>
                      <IconChevronRight size={16} color={colors.textTertiary} />
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            {(data.total > size || offset > 0) && (
              <Pager offset={offset} total={data.total} size={size} onChange={setOffset} />
            )}
          </>
        )}
      </QueryState>
      {!!selectedId && (
        <RequestSheet
          visible
          variant="compact"
          title={t('workerRequests.incomingSwap')}
          icon={<IconSwap size={22} color={colors.primary} />}
          onClose={close}
          busy={command.isPending}
          footer={
            <View style={styles.actions}>
              <ErrorNotice error={command.error} />
              {canRespond ? (
                <>
                  <Button
                    label={t('requests.agreeSwap')}
                    disabled={
                      command.isPending ||
                      selected.isRefetchError ||
                      !knownShifts ||
                      shifts.isRefetchError
                    }
                    onPress={() => respond(true)}
                  />
                  <Button
                    secondary
                    label={t('requests.reject')}
                    disabled={
                      command.isPending || selected.isRefetchError || reason.trim().length < 5
                    }
                    onPress={() => respond(false)}
                  />
                </>
              ) : (
                <Button secondary label={t('common.close')} onPress={close} />
              )}
            </View>
          }
        >
          <QueryState query={selected}>
            {(row) =>
              !recipient(row) ? (
                <Hint>{t('requests.outOfScope')}</Hint>
              ) : (
                <>
                  <ManagementBadge
                    label={localizedLabel(row.status)}
                    tone={row.status.startsWith('PENDING') ? 'warning' : 'neutral'}
                  />
                  <Hint>{t('workerRequests.swapConsentHint')}</Hint>
                  <QueryState query={shifts}>
                    {() => (
                      <View style={styles.shiftCards}>
                        {shiftCard(
                          t('workerRequests.yourShift'),
                          row.coworkerShiftId,
                          row.coworkerWorkDate,
                        )}
                        {shiftCard(
                          t('workerRequests.offeredShift'),
                          row.requesterShiftId,
                          row.requesterWorkDate,
                        )}
                      </View>
                    )}
                  </QueryState>
                  <View style={styles.reasonBlock}>
                    <Text style={styles.label}>{t('requests.reason')}</Text>
                    <Text style={styles.reason}>{row.reason}</Text>
                  </View>
                  <Text style={styles.caption}>
                    {t('attendanceUi.submittedOn')} {displayTime(row.createdAt)}
                  </Text>
                  {row.reviewReason && <Hint>{row.reviewReason}</Hint>}
                  {canRespond && (
                    <>
                      <Field
                        label={t('requests.rejectionReason')}
                        multiline
                        maxLength={1000}
                        value={reason}
                        onChangeText={setReason}
                        editable={!command.isPending}
                      />
                      <Text style={styles.caption}>{t('workerRequests.declineHint')}</Text>
                    </>
                  )}
                </>
              )
            }
          </QueryState>
        </RequestSheet>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.borderLight },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0, gap: 7 },
  title: { color: colors.textPrimary, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  date: { color: colors.textMuted, fontSize: 11, lineHeight: 18 },
  meta: { color: colors.textSecondary, fontSize: 12, lineHeight: 19 },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  notice: {
    color: colors.successText,
    backgroundColor: colors.successBg,
    padding: 14,
    borderRadius: 14,
    fontSize: 13,
    lineHeight: 21,
  },
  pressed: { opacity: 0.65 },
  actions: { gap: 8 },
  shiftCards: { gap: 10 },
  shiftCard: {
    padding: 14,
    gap: 5,
    borderRadius: 14,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  label: { color: colors.textMuted, fontSize: 12, lineHeight: 19, fontWeight: '600' },
  shiftName: { color: colors.textPrimary, fontSize: 15, lineHeight: 23, fontWeight: '600' },
  reasonBlock: { gap: 6 },
  reason: { color: colors.textPrimary, fontSize: 14, lineHeight: 23 },
});
