import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { allPages, displayTime, useCommand } from '../shared/data';
import {
  Button,
  Card,
  Choice,
  CompactTabs,
  ErrorNotice,
  Field,
  Hint,
  Pager,
  QueryState,
} from '../shared/ui';
import { RequestSheet } from '../shared/request-sheet';
import { FormSection } from '../shared/form-section';
import { TimeRequestModal } from './time-request-modal';
import { IconDocument, IconUser } from '../../components/common/Icons';
import { colors } from '../../theme/colors';
import { DetailLink, EmptyState, ListHeading } from '../contractor/contractor-presentation';

/** Leave and overtime share the same scoped review queue. */
export function TimeRequestsPanel() {
  const { t } = useTranslation();
  const { client, token, scope, queryKey, user } = useWorkspace();
  const workers = useScopedWorkers();
  const [kind, setKind] = useState<'LEAVE' | 'OVERTIME'>('LEAVE');
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [offset, setOffset] = useState(0);
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState('');
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
  const detail = query.data?.items.find((row) => row.id === selected);
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
      <CompactTabs
        value={kind}
        options={[
          { value: 'LEAVE', label: t('attendance.leave') },
          { value: 'OVERTIME', label: t('attendance.overtime') },
        ]}
        onChange={(value) => {
          setKind(value as typeof kind);
          setOffset(0);
          setSelected('');
          command.reset();
        }}
      />
      <CompactTabs
        value={status}
        options={['PENDING', 'APPROVED', 'REJECTED'].map((value) => ({
          value,
          label: localizedLabel(value),
        }))}
        onChange={(value) => {
          setStatus(value as typeof status);
          setOffset(0);
          setSelected('');
          command.reset();
        }}
      />
      <Button
        secondary
        label={t('leavePolicy.recordOnBehalf')}
        onPress={() => setChoosingWorker(true)}
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
            {data.total > 8 && (
              <Pager offset={offset} total={data.total} size={8} onChange={setOffset} />
            )}
          </>
        )}
      </QueryState>
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
                    disabled={command.isPending || query.isRefetchError}
                    onPress={() => review(true)}
                  />
                  <Button
                    secondary
                    label={t('leavePolicy.reject')}
                    disabled={command.isPending || !note.trim() || query.isRefetchError}
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
