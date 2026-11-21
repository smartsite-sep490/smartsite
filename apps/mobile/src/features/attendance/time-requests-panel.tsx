import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { allPages, displayTime, useCommand } from '../shared/data';
import { Button, Card, Choice, ErrorNotice, Field, Hint, Pager, QueryState } from '../shared/ui';
import { RequestListFilters } from '../shared/request-list-filters';
import { RequestSheet } from '../shared/request-sheet';
import { FormSection } from '../shared/form-section';
import { TimeRequestModal } from './time-request-modal';
import { IconDocument, IconPlus, IconUser } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { DetailLink, EmptyState, ListHeading } from '../contractor/contractor-presentation';

/** Leave and overtime share the same scoped review queue. */
export function TimeRequestsPanel({ initialId }: { initialId?: string } = {}) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey, user } = useWorkspace();
  const workers = useScopedWorkers();
  const [kind, setKind] = useState<'LEAVE' | 'OVERTIME'>('LEAVE');
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [offset, setOffset] = useState(0);
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState(initialId ?? '');
  const [workerId, setWorkerId] = useState('');
  const [choosingWorker, setChoosingWorker] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const command = useCommand();
  const query = useQuery({
    queryKey: [...queryKey, 'time-review', kind, status, offset],
    enabled: workers.isSuccess && scope.role === 'contractor',
    queryFn: async ({ signal }) => {
      const ids = new Set(workers.data?.map((worker) => worker.id));
      const rows = (
        await allPages(
          (page) => client.attendanceTimeRequests(token, scope.siteId, { ...page, kind, status }),
          signal,
        )
      ).filter((request) => ids.has(request.workerId));
      return { items: rows.slice(offset, offset + 8), total: rows.length };
    },
    refetchInterval: 15000,
  });
  const detailQuery = useQuery({
    queryKey: [...queryKey, 'time-review-detail', selected],
    enabled: !!selected && workers.isSuccess && scope.role === 'contractor',
    refetchInterval: 15000,
    queryFn: async () => {
      const ids = new Set(workers.data?.map((worker) => worker.id));
      for (const requestKind of ['LEAVE', 'OVERTIME'] as const) {
        const result = await client.attendanceTimeRequests(token, scope.siteId, {
          kind: requestKind,
          requestId: selected,
          limit: 1,
        });
        const row = result.items.find((item) => item.id === selected && ids.has(item.workerId));
        if (row) return row;
      }
      return null;
    },
  });
  const detail = selected ? detailQuery.data : null;
  const canReview =
    detail &&
    ['PENDING_MANAGER', 'PENDING'].includes(detail.status) &&
    detail.requestedByUserId !== user.id;
  const review = (approve: boolean) => {
    if (!detail || !canReview) return;
    command.mutate(async () => {
      await client.reviewAttendanceTime(token, scope.siteId, detail.id, detail.kind, {
        approve,
        ...(note.trim() ? { reviewNote: note.trim() } : {}),
      });
      setSelected('');
      setNote('');
    });
  };
  if (scope.role !== 'contractor') return null;
  return (
    <>
      <RequestListFilters
        kind={kind}
        status={status}
        kinds={[
          { value: 'LEAVE', label: t('attendance.leave') },
          { value: 'OVERTIME', label: t('attendance.overtime') },
        ]}
        statuses={['PENDING', 'APPROVED', 'REJECTED'].map((value) => ({
          value,
          label: localizedLabel(value),
        }))}
        onApply={(nextKind, nextStatus) => {
          setKind(nextKind as typeof kind);
          setStatus(nextStatus as typeof status);
          setOffset(0);
          setSelected('');
          setNote('');
          command.reset();
        }}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('leavePolicy.recordOnBehalf')}
            onPress={() => setChoosingWorker(true)}
            style={({ pressed }) => [styles.recordAction, pressed && { opacity: 0.65 }]}
          >
            <IconPlus size={16} color={colors.primary} />
            <Text style={styles.recordText}>{t('contractorUi.recordLeaveShort')}</Text>
          </Pressable>
        }
      />
      <QueryState query={query}>
        {(data) => (
          <>
            <ListHeading
              title={t('leavePolicy.title')}
              count={t('contractorUi.requestCount', { count: data.total })}
            />
            {!data.items.length && (
              <EmptyState
                icon={<IconDocument size={26} color={colors.primary} />}
                title={t('requests.noRequests')}
                hint={t('contractorUi.requestEmptyHint')}
              />
            )}
            {data.items.map((request) => (
              <Card key={request.id}>
                <View style={styles.heading}>
                  <Text style={styles.name}>{request.workerName}</Text>
                  <Text
                    style={[styles.status, request.status.startsWith('PENDING') && styles.pending]}
                  >
                    {localizedLabel(request.status)}
                  </Text>
                </View>
                <Text style={styles.caption}>
                  {displayTime(request.startsAt)} – {displayTime(request.endsAt)}
                </Text>
                <Text style={styles.reason} numberOfLines={2}>
                  {request.reason}
                </Text>
                {request.kind === 'LEAVE' && (
                  <Text style={styles.caption}>
                    {t(
                      request.noticeType === 'EMERGENCY'
                        ? 'leavePolicy.emergency'
                        : request.noticeType === 'PLANNED'
                          ? 'leavePolicy.planned'
                          : 'leavePolicy.legacyNotice',
                    )}
                  </Text>
                )}
                {request.shortNotice && (
                  <Text style={styles.notice}>{t('leavePolicy.shortNotice')}</Text>
                )}
                {request.submittedOnBehalf && (
                  <Text style={styles.caption}>{t('leavePolicy.submittedOnBehalf')}</Text>
                )}
                {request.reviewNote && <Text style={styles.caption}>{request.reviewNote}</Text>}
                {request.requestedByUserId === user.id &&
                ['PENDING_MANAGER', 'PENDING'].includes(request.status) ? (
                  <Hint>{t('leavePolicy.anotherReviewer')}</Hint>
                ) : (
                  <DetailLink
                    label={t('requests.viewRequest')}
                    onPress={() => {
                      setSelected(request.id);
                      setNote('');
                      command.reset();
                    }}
                  />
                )}
              </Card>
            ))}
            {(data.total > 8 || offset > 0) && (
              <Pager offset={offset} total={data.total} size={8} onChange={setOffset} />
            )}
          </>
        )}
      </QueryState>
      {!!selected && (
        <QueryState query={detailQuery}>
          {(data) => (data ? null : <Hint>{t('requests.outOfScope')}</Hint>)}
        </QueryState>
      )}
      {detail && (
        <RequestSheet
          visible
          variant="form"
          icon={<IconDocument size={23} color={colors.primary} />}
          title={t('requests.viewRequest')}
          subtitle={t(
            detail.kind === 'LEAVE' ? 'attendanceUi.leaveAction' : 'attendanceUi.overtimeAction',
          )}
          busy={command.isPending}
          onClose={() => {
            setSelected('');
            command.reset();
          }}
          footer={
            <View style={styles.actions}>
              <ErrorNotice error={command.error} />
              {canReview ? (
                <>
                  <Button
                    label={t('leavePolicy.approve')}
                    disabled={command.isPending || detailQuery.isRefetchError}
                    onPress={() => review(true)}
                  />
                  <Button
                    secondary
                    label={t('leavePolicy.reject')}
                    disabled={command.isPending || !note.trim() || detailQuery.isRefetchError}
                    onPress={() => review(false)}
                  />
                </>
              ) : (
                <Button secondary label={t('common.close')} onPress={() => setSelected('')} />
              )}
            </View>
          }
        >
          <FormSection number="01" title={t('requests.requester')}>
            <Text style={styles.name}>{detail.workerName}</Text>
            <Text style={styles.status}>{localizedLabel(detail.status)}</Text>
            <Text style={styles.caption}>
              {displayTime(detail.startsAt)} – {displayTime(detail.endsAt)}
            </Text>
            {detail.createdAt && (
              <Text style={styles.caption}>
                {t('leavePolicy.submittedAt', { time: displayTime(detail.createdAt) })}
              </Text>
            )}
            {detail.shortNotice && (
              <Text style={styles.notice}>{t('leavePolicy.shortNotice')}</Text>
            )}
            {detail.submittedOnBehalf && (
              <Text style={styles.caption}>{t('leavePolicy.submittedOnBehalf')}</Text>
            )}
          </FormSection>
          <FormSection number="02" title={t('requests.reason')}>
            <Text style={styles.reason}>{detail.reason}</Text>
            {detail.kind === 'LEAVE' && (
              <Text style={styles.caption}>
                {t(
                  detail.noticeType === 'EMERGENCY'
                    ? 'leavePolicy.emergency'
                    : detail.noticeType === 'PLANNED'
                      ? 'leavePolicy.planned'
                      : 'leavePolicy.legacyNotice',
                )}
              </Text>
            )}
          </FormSection>
          {canReview ? (
            <FormSection number="03" title={t('leavePolicy.reviewNote')}>
              <Field
                label={t('leavePolicy.reviewNote')}
                value={note}
                onChangeText={setNote}
                multiline
                editable={!command.isPending}
              />
              <Text style={styles.caption}>{t('contractorUi.rejectHint')}</Text>
            </FormSection>
          ) : (
            detail.reviewNote && (
              <FormSection number="03" title={t('attendanceUi.reviewNote')}>
                <Text style={styles.reason}>{detail.reviewNote}</Text>
              </FormSection>
            )
          )}
        </RequestSheet>
      )}
      {choosingWorker && (
        <RequestSheet
          visible
          variant="form"
          icon={<IconUser size={23} color={colors.primary} />}
          title={t('leavePolicy.recordOnBehalf')}
          subtitle={t('contractorUi.chooseWorkerHint')}
          onClose={() => setChoosingWorker(false)}
          footer={
            <Button
              label={t('common.continue')}
              disabled={!workerId || !workers.isSuccess || workers.isRefetchError}
              onPress={() => {
                setChoosingWorker(false);
                setRecordOpen(true);
              }}
            />
          }
        >
          <FormSection number="01" title={t('schedule.worker')}>
            <QueryState query={workers}>
              {(data) => (
                <Choice
                  label={t('schedule.worker')}
                  value={workerId}
                  onChange={setWorkerId}
                  options={data.map((worker) => ({
                    value: worker.id,
                    label: `${worker.displayName} · ${worker.externalId}`,
                  }))}
                />
              )}
            </QueryState>
          </FormSection>
        </RequestSheet>
      )}
      {recordOpen && (
        <TimeRequestModal
          key={workerId}
          visible
          onClose={() => setRecordOpen(false)}
          onBehalfWorkerId={workerId}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  recordAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.primaryLight,
  },
  recordText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  heading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  name: {
    flex: 1,
    minWidth: 120,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  status: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textSecondary,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 8,
    overflow: 'hidden',
  },
  pending: { color: colors.warningText, backgroundColor: colors.warningLightBg },
  caption: { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  reason: { fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  notice: { fontSize: 12, lineHeight: 20, color: colors.warningText },
  actions: { gap: 10 },
});
