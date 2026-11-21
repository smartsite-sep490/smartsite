import { shiftRequestLocked, useShiftRequestLocked } from './shift-request-deadline';
import { ContractorSchedule } from '../contractor/contractor-schedule';
import { localizedLabel } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ShiftRequestListOptions,
  ShiftRequestResponse,
  WorkerScheduleResponse,
  ShiftResponse,
} from '@smartsite/api-client';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { requestInScope } from './request-scope';
import { allPages, displayTime, displayShiftTime, required, useCommand } from '../shared/data';
import {
  Body,
  Button,
  Card,
  Choice,
  ErrorNotice,
  Field,
  Hint,
  Page,
  Pager,
  QueryState,
  Disclosure,
  CompactTabs,
} from '../shared/ui';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from '../../i18n';
import { colors } from '../../theme/colors';
import { WorkerScheduleScreen } from './worker-schedule-screen';
import { LeaveNoticeFields } from './leave-notice-fields';
import { TimeRequestsPanel } from '../attendance/time-requests-panel';
import { RequestListFilters } from '../shared/request-list-filters';
import { WorkerRequestHistory } from './worker-request-history';
import { WorkerRequestsScreen } from './worker-incoming-requests';
import { useWorkerLeaveAvailability } from './worker-leave-availability';
import { useRequestFeedback } from '../shared/request-feedback';
import { RequestSheet } from '../shared/request-sheet';
import { FormSection } from '../shared/form-section';
import { DetailLink, EmptyState, ListHeading } from '../contractor/contractor-presentation';
import { IconDocument } from '../../components/common/Icons';
import type { LeaveNoticeType } from '@smartsite/api-client';
import {
  requestScheduleIssue,
  requestTimingMessage,
  useEligibleTimeSchedules,
} from './time-request-eligibility';

export function ScheduleScreen({ initialDate }: { initialDate?: string }) {
  const { scope } = useWorkspace();
  const [calendarDay, setCalendarDay] = useState(initialDate);
  const [request, setRequest] = useState<{
    schedule: WorkerScheduleResponse;
    shift?: ShiftResponse;
  } | null>(null);
  if (scope.role === 'contractor') return <ContractorSchedule initialDate={initialDate} />;
  if (request)
    return (
      <ScheduleRequest
        key={request.schedule.id}
        schedule={request.schedule}
        shift={request.shift}
        onBack={() => setRequest(null)}
      />
    );
  return (
    <WorkerScheduleScreen
      initialDate={calendarDay}
      onRequest={(schedule, shift) => {
        setCalendarDay(schedule.workDate);
        setRequest({ schedule, shift });
      }}
    />
  );
}

function ScheduleRequest({
  schedule,
  shift,
  onBack,
}: {
  schedule: WorkerScheduleResponse;
  shift?: ShiftResponse;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [noticeType, setNoticeType] = useState<LeaveNoticeType>('PLANNED');
  const [kind, setKind] = useState('CHANGE'),
    [target, setTarget] = useState(''),
    [reason, setReason] = useState('');
  const command = useCommand();
  const reportSubmitted = useRequestFeedback();
  const leaveAvailability = useWorkerLeaveAvailability(kind === 'ABSENCE');
  const eligible = useQuery({
    queryKey: [...queryKey, 'eligible', schedule.id],
    queryFn: () => client.listEligibleShifts(token, scope.siteId, schedule.id),
    enabled: kind === 'CHANGE',
  });
  const candidates = useQuery({
    queryKey: [...queryKey, 'swap-candidates', schedule.id],
    queryFn: () => client.listSwapCandidates(token, scope.siteId, schedule.id),
    enabled: kind === 'SWAP',
  });
  const sourceLocked = useShiftRequestLocked(schedule.workDate, shift);
  const targetShift =
    kind === 'CHANGE'
      ? eligible.data?.items.find((s) => s.id === target)
      : candidates.data?.items.find((c) => c.candidateWorkerScheduleId === target)?.currentShift;
  const targetLocked = useShiftRequestLocked(schedule.workDate, targetShift);
  const { now } = useEligibleTimeSchedules([schedule], shift ? [shift] : [], 'LEAVE', noticeType);
  const leaveIssue = requestScheduleIssue(schedule.workDate, shift, 'LEAVE', noticeType, now);
  const locked =
    kind === 'ABSENCE'
      ? !!leaveIssue || !leaveAvailability.ready || leaveAvailability.locked
      : sourceLocked || (!!target && targetLocked);
  return (
    <Page title={t('schedule.requestTitle')} onBack={onBack}>
      <Card>
        <Body>
          {schedule.workDate} · {shift?.name}
        </Body>
        <Choice
          label={t('schedule.requestType')}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setTarget('');
            command.reset();
          }}
          options={[
            { value: 'CHANGE', label: t('requests.changeShift') },
            { value: 'SWAP', label: t('requests.swapWithCoworker') },
            { value: 'ABSENCE', label: t('requests.absenceFullShift') },
          ]}
        />
        {kind === 'CHANGE' && (
          <QueryState query={eligible}>
            {(data) => (
              <Choice
                label={t('requests.alternativeShift')}
                value={target}
                options={data.items.map((s) => ({
                  value: s.id,
                  label: `${s.name} · ${displayShiftTime(s.startsAt)} – ${displayShiftTime(s.endsAt)}`,
                }))}
                onChange={setTarget}
              />
            )}
          </QueryState>
        )}
        {kind === 'SWAP' && (
          <QueryState query={candidates}>
            {(data) => (
              <Choice
                label={t('requests.coworkerToSwap')}
                value={target}
                options={data.items.map((c) => ({
                  value: c.candidateWorkerScheduleId,
                  label: `${c.candidateWorkerDisplayName} · ${c.workDate} · ${c.currentShift.name}`,
                }))}
                onChange={setTarget}
              />
            )}
          </QueryState>
        )}
        <Field label={t('schedule.reason')} multiline value={reason} onChangeText={setReason} />
        <Hint>
          {kind === 'SWAP'
            ? tr('requests.swapNotice')
            : kind === 'CHANGE'
              ? tr('requests.changeReviewHint')
              : tr('requests.absenceReviewHint')}
        </Hint>
        {locked && (kind !== 'ABSENCE' || leaveIssue) && (
          <Hint>
            {kind === 'ABSENCE' && leaveIssue
              ? requestTimingMessage(leaveIssue)
              : t('schedule.shiftStartedLocked')}
          </Hint>
        )}
        <ErrorNotice error={command.error} />
        {kind === 'ABSENCE' && <LeaveNoticeFields value={noticeType} onChange={setNoticeType} />}
        {kind === 'ABSENCE' && leaveAvailability.message && (
          <Hint>{leaveAvailability.message}</Hint>
        )}
        <ErrorNotice error={leaveAvailability.error} />
        <Button
          label={command.isPending ? t('requests.sending') : t('requests.submitRequest')}
          disabled={
            command.isPending ||
            locked ||
            !reason.trim() ||
            !shift ||
            (kind !== 'ABSENCE' && !target)
          }
          onPress={() =>
            command.mutate(async () => {
              if (
                kind !== 'ABSENCE' &&
                (shiftRequestLocked(schedule.workDate, shift) ||
                  shiftRequestLocked(schedule.workDate, targetShift))
              )
                return;
              if (kind === 'ABSENCE') {
                if (!leaveAvailability.ready || leaveAvailability.locked)
                  throw new Error(leaveAvailability.message || t('common.retry'));
                const issue = requestScheduleIssue(schedule.workDate, shift, 'LEAVE', noticeType);
                if (issue) throw new Error(requestTimingMessage(issue));
              }
              const why = required(reason, t('schedule.reason'));
              if (kind === 'CHANGE')
                await client.createShiftChangeRequest(token, scope.siteId, {
                  workerScheduleId: schedule.id,
                  toShiftId: target,
                  reason: why,
                });
              else if (kind === 'SWAP')
                await client.createShiftSwapRequest(token, scope.siteId, {
                  requesterWorkerScheduleId: schedule.id,
                  coworkerWorkerScheduleId: target,
                  reason: why,
                });
              else
                await client.createAbsenceRequest(token, scope.siteId, {
                  workerScheduleId: schedule.id,
                  reason: why,
                  noticeType,
                });
              reportSubmitted();
              onBack();
            })
          }
        />
      </Card>
    </Page>
  );
}
type ShiftRequestsScreenProps = {
  initialId?: string;
  initialKind?: string;
  initialView?: 'INCOMING';
  onBack?: () => void;
};
export function ShiftRequestsScreen(props: ShiftRequestsScreenProps) {
  const { scope } = useWorkspace();
  return scope.role === 'worker' ? (
    <WorkerRequestsScreen {...props} />
  ) : (
    <ContractorRequestsScreen {...props} />
  );
}
function ContractorRequestsScreen({
  initialId,
  initialKind,
  initialView,
  onBack,
}: ShiftRequestsScreenProps) {
  const { t } = useTranslation();
  const { scope, client, token, user, queryKey } = useWorkspace();
  const rep = scope.role === 'contractor';
  const pageSize = rep ? 8 : 20;
  const timeTarget =
    initialKind === 'TIME' || initialKind === 'LEAVE' || initialKind === 'OVERTIME';
  const [category, setCategory] = useState<'SHIFTS' | 'TIME'>(timeTarget ? 'TIME' : 'SHIFTS');
  const [notificationDismissed, setNotificationDismissed] = useState(false);
  const [view, setView] = useState<ShiftRequestListOptions['view']>(
      rep ? 'REVIEW' : (initialView ?? 'WORKER'),
    ),
    [type, setType] = useState<'ALL' | 'CHANGE' | 'SWAP'>('ALL'),
    [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ShiftRequestResponse | null>(null),
    [reason, setReason] = useState('');
  const command = useCommand();
  const workers = useScopedWorkers();
  const workerIds = new Set(workers.data?.map((w) => w.id));
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) => allPages((p) => client.listShifts(token, scope.siteId, p), signal),
    enabled: category === 'SHIFTS' && (rep || view === 'INCOMING'),
  });
  const getWorkerName = (id?: string | null) => {
    if (!id) return t('schedule.worker');
    const w = workers.data?.find((item) => item.id === id || item.userId === id);
    return w?.displayName || id.slice(0, 8);
  };
  const getShiftLabel = (id?: string | null) => {
    if (!id) return '—';
    const s = shifts.data?.find((item) => item.id === id);
    return s
      ? `${s.name} (${displayShiftTime(s.startsAt)} - ${displayShiftTime(s.endsAt)})`
      : id.slice(0, 8);
  };
  const query = useQuery({
    queryKey: [...queryKey, 'shift-requests', view, type, offset],
    enabled: workers.isSuccess && category === 'SHIFTS' && (rep || view === 'INCOMING'),
    queryFn: async ({ signal }) => {
      const rows = (
        await allPages(
          (p) => client.listShiftRequests(token, scope.siteId, { view, requestType: type, ...p }),
          signal,
        )
      ).filter((r) => requestInScope(r, workerIds, scope.role));
      return {
        items: rows.slice(offset, offset + pageSize),
        total: rows.length,
        pendingCount: rows.filter((r) => r.status === 'PENDING_MANAGER').length,
        incomingCount: rows.filter((r) => r.status === 'PENDING_COWORKER').length,
      };
    },
    refetchInterval: 15000,
  });
  const detailId =
    selected?.id ??
    (notificationDismissed || timeTarget || (!rep && view === 'WORKER') ? undefined : initialId);
  const detailKind = selected?.requestType ?? initialKind;
  const incoming = useQuery({
    queryKey: [...queryKey, 'shift-request-detail', detailId, detailKind],
    enabled: !!detailId,
    initialData: selected ?? undefined,
    refetchInterval: 15000,
    queryFn: async (): Promise<ShiftRequestResponse> =>
      detailKind === 'SWAP'
        ? {
            ...(await client.getShiftSwapRequest(token, scope.siteId, detailId!)),
            requestType: 'SWAP',
          }
        : {
            ...(await client.getShiftChangeRequest(token, scope.siteId, detailId!)),
            requestType: 'CHANGE',
          },
  });
  const team = useQuery({
    queryKey: [...queryKey, 'my-team'],
    queryFn: () => client.myContractorTeam(token, scope.siteId),
    enabled: !rep && view === 'INCOMING',
  });
  const detail = detailId ? incoming.data : undefined;
  const renderDetail = (r: ShiftRequestResponse, part?: 'footer') => {
    if (!requestInScope(r, workerIds, scope.role)) return <Hint>{tr('requests.outOfScope')}</Hint>;
    const canReview =
      rep &&
      r.status === 'PENDING_MANAGER' &&
      r.requestedByUserId !== user.id &&
      (r.requestType !== 'SWAP' || !!r.coworkerConfirmedAt);
    const canRespond =
      !rep &&
      r.requestType === 'SWAP' &&
      r.status === 'PENDING_COWORKER' &&
      r.coworkerWorkerId === team.data?.workerId &&
      r.requestedByUserId !== user.id;
    const run = (approve: boolean) =>
      command.mutate(async () => {
        if (!approve) required(reason, t('requests.rejectionReason'));
        if (canRespond) {
          if (approve) await client.confirmShiftSwapRequest(token, scope.siteId, r.id);
          else await client.declineShiftSwapRequest(token, scope.siteId, r.id, { reason });
        } else if (canReview && r.requestType === 'CHANGE') {
          if (approve) await client.approveShiftChangeRequest(token, scope.siteId, r.id);
          else await client.rejectShiftChangeRequest(token, scope.siteId, r.id, { reason });
        } else if (canReview) {
          if (approve) await client.approveShiftSwapRequest(token, scope.siteId, r.id);
          else await client.rejectShiftSwapRequest(token, scope.siteId, r.id, { reason });
        } else throw new Error(tr('validation.requestStateChanged'));
        setSelected(null);
        setNotificationDismissed(true);
        setReason('');
      });
    if (rep) {
      if (part === 'footer')
        return (
          <View style={schedStyles.repActions}>
            <ErrorNotice error={command.error} />
            {canReview ? (
              <>
                <Button
                  label={t('requests.approveRequest')}
                  disabled={command.isPending || incoming.isRefetchError}
                  onPress={() => run(true)}
                />
                <Button
                  secondary
                  label={t('requests.reject')}
                  disabled={command.isPending || !reason.trim() || incoming.isRefetchError}
                  onPress={() => run(false)}
                />
              </>
            ) : (
              <Button
                secondary
                label={t('common.close')}
                onPress={() => {
                  setSelected(null);
                  setNotificationDismissed(true);
                }}
              />
            )}
          </View>
        );
      return (
        <>
          <FormSection number="01" title={t('requests.requester')}>
            <Text style={schedStyles.repName}>
              {r.requestType === 'SWAP'
                ? getWorkerName(r.requesterWorkerId) + ' ↔ ' + getWorkerName(r.coworkerWorkerId)
                : getWorkerName(r.workerId)}
            </Text>
            <Text style={schedStyles.repBadge}>{localizedLabel(r.status)}</Text>
            <Text style={schedStyles.repCaption}>
              {r.requestType === 'SWAP'
                ? (r.requesterWorkDate ?? '—') + ' ↔ ' + (r.coworkerWorkDate ?? '—')
                : (r.workDate ?? '—')}
            </Text>
            <Text style={schedStyles.repShift}>
              {r.requestType === 'SWAP'
                ? getShiftLabel(r.requesterShiftId) + ' ↔ ' + getShiftLabel(r.coworkerShiftId)
                : getShiftLabel(r.fromShiftId) + ' → ' + getShiftLabel(r.toShiftId)}
            </Text>
            <Text style={schedStyles.repCaption}>
              {tr('requests.submittedAt')} {displayTime(r.createdAt)}
            </Text>
            {r.reviewedAt && (
              <Text style={schedStyles.repCaption}>
                {tr('requests.reviewedAt')} {displayTime(r.reviewedAt)}
              </Text>
            )}
          </FormSection>
          <FormSection number="02" title={t('requests.reason')}>
            <Text style={schedStyles.repReason}>{r.reason || '—'}</Text>
            {r.reviewReason && (
              <Text style={schedStyles.repReason}>
                {tr('requests.reviewReason')} {r.reviewReason}
              </Text>
            )}
          </FormSection>
          {canReview && (
            <FormSection number="03" title={t('attendanceUi.reviewNote')}>
              <Field
                label={t('requests.rejectionReason')}
                value={reason}
                onChangeText={setReason}
                multiline
                editable={!command.isPending}
              />
              <Text style={schedStyles.repCaption}>{t('contractorUi.rejectHint')}</Text>
            </FormSection>
          )}
        </>
      );
    }
    return (
      <View style={schedStyles.detailCard}>
        <View style={schedStyles.detailHeaderRow}>
          <View
            style={[
              schedStyles.typePill,
              { backgroundColor: r.requestType === 'SWAP' ? '#EFF6FF' : '#FFF4EE' },
            ]}
          >
            <Text
              style={[
                schedStyles.typePillText,
                { color: r.requestType === 'SWAP' ? '#2563EB' : '#F66B17' },
              ]}
            >
              {r.requestType === 'SWAP' ? t('requests.swapRequest') : t('requests.changeShift')}
            </Text>
          </View>
          <View
            style={[
              schedStyles.statusPill,
              {
                backgroundColor:
                  r.status === 'APPROVED'
                    ? '#EDFAF2'
                    : r.status === 'REJECTED'
                      ? '#FEE2E2'
                      : '#FEF3C7',
              },
            ]}
          >
            <Text
              style={[
                schedStyles.statusPillText,
                {
                  color:
                    r.status === 'APPROVED'
                      ? '#065F46'
                      : r.status === 'REJECTED'
                        ? '#DC2626'
                        : '#B45309',
                },
              ]}
            >
              {localizedLabel(r.status)}
            </Text>
          </View>
        </View>

        <Text style={schedStyles.detailWorkerText}>
          {r.requestType === 'SWAP'
            ? `${getWorkerName(r.requesterWorkerId)} ↔ ${getWorkerName(r.coworkerWorkerId)}`
            : getWorkerName(r.workerId)}
        </Text>

        <View style={schedStyles.shiftTransitionBox}>
          <Text style={schedStyles.shiftDateText}>
            📅 {t('schedule.date')}:{' '}
            <Text style={{ fontWeight: '700' }}>
              {r.requestType === 'SWAP'
                ? `${r.requesterWorkDate ?? '—'} ↔ ${r.coworkerWorkDate ?? '—'}`
                : (r.workDate ?? '—')}
            </Text>
          </Text>
          <View style={schedStyles.shiftRow}>
            {r.requestType === 'SWAP' ? (
              <Text style={schedStyles.shiftTransitionText}>
                <Text style={schedStyles.shiftSourceText}>{getShiftLabel(r.requesterShiftId)}</Text>
                {' ↔ '}
                <Text style={schedStyles.shiftTargetText}>{getShiftLabel(r.coworkerShiftId)}</Text>
              </Text>
            ) : (
              <Text style={schedStyles.shiftTransitionText}>
                <Text style={schedStyles.shiftSourceText}>{getShiftLabel(r.fromShiftId)}</Text>
                {' → '}
                <Text style={schedStyles.shiftTargetText}>{getShiftLabel(r.toShiftId)}</Text>
              </Text>
            )}
          </View>
        </View>

        {r.reason ? (
          <View style={schedStyles.reasonBox}>
            <Text style={schedStyles.reasonLabel}>{t('schedule.reason')}:</Text>
            <Text style={schedStyles.reasonContent}>"{r.reason}"</Text>
          </View>
        ) : null}

        <View style={schedStyles.detailInfoGrid}>
          <Text style={schedStyles.detailInfoSub}>
            {tr('requests.submittedAt')} {displayTime(r.createdAt)} {tr('requests.reviewedAt')}{' '}
            {displayTime(r.reviewedAt)}
          </Text>
          {r.reviewReason && (
            <Text style={schedStyles.detailReviewReason}>
              {tr('requests.reviewReason')} {r.reviewReason}
            </Text>
          )}
        </View>

        {(canReview || canRespond) && (
          <View style={{ marginTop: 12 }}>
            <Field label={t('requests.rejectionReason')} value={reason} onChangeText={setReason} />
            <Button
              label={canRespond ? t('requests.agreeSwap') : t('requests.approveRequest')}
              disabled={command.isPending}
              onPress={() => run(true)}
            />
            <Button
              secondary
              label={t('requests.reject')}
              disabled={command.isPending || !reason.trim()}
              onPress={() => run(false)}
            />
          </View>
        )}
      </View>
    );
  };
  if (!rep && view === 'WORKER')
    return (
      <Page title={t('workerRequests.sentTitle')} onBack={onBack}>
        <CompactTabs
          value="WORKER"
          options={[
            { value: 'WORKER', label: t('workerRequests.sentTab') },
            { value: 'INCOMING', label: t('workerRequests.incomingTab') },
          ]}
          onChange={() => setView('INCOMING')}
        />
        <WorkerRequestHistory initialId={initialId} />
      </Page>
    );
  if (!workers.isSuccess)
    return (
      <Page title={tr('attendance.workerScope')} onBack={onBack}>
        <QueryState query={workers}>{() => null}</QueryState>
      </Page>
    );
  return (
    <Page title={rep ? t('contractorHome.approveRequests') : t('requests.title')} onBack={onBack}>
      {rep && (
        <>
          <Text style={schedStyles.repSubtitle}>
            {scope.contractorName} · {scope.siteName}
          </Text>
          <CompactTabs
            value={category}
            options={[
              { value: 'SHIFTS', label: t('contractorUi.requestShiftGroup') },
              { value: 'TIME', label: t('contractorUi.requestTimeGroup') },
            ]}
            onChange={(value) => {
              setCategory(value as typeof category);
              setNotificationDismissed(true);
              setSelected(null);
              setReason('');
              command.reset();
            }}
          />
        </>
      )}

      {rep && category === 'TIME' ? (
        <TimeRequestsPanel
          initialId={timeTarget && !notificationDismissed ? initialId : undefined}
        />
      ) : (
        <>
          {rep ? (
            <RequestListFilters
              kind={type}
              status={view ?? 'REVIEW'}
              kinds={[
                { value: 'ALL', label: t('common.all') },
                { value: 'CHANGE', label: t('requests.typeChange') },
                { value: 'SWAP', label: t('requests.typeSwap') },
              ]}
              statuses={[
                { value: 'REVIEW', label: t('requests.awaitingMyReview') },
                { value: 'HISTORY', label: t('requests.history') },
              ]}
              onApply={(nextKind, nextStatus) => {
                setType(nextKind as typeof type);
                setView(nextStatus as ShiftRequestListOptions['view']);
                setOffset(0);
                setSelected(null);
                setNotificationDismissed(true);
                setReason('');
                command.reset();
              }}
            />
          ) : (
            <Disclosure title={t('contractorUi.filters')} collapsible={rep}>
              <Choice
                label={tr('requests.list')}
                value={view}
                onChange={(v) => {
                  setView(v as ShiftRequestListOptions['view']);
                  setOffset(0);
                  setSelected(null);
                  command.reset();
                }}
                options={
                  rep
                    ? [
                        { value: 'REVIEW', label: tr('requests.awaitingMyReview') },
                        { value: 'HISTORY', label: tr('requests.history') },
                      ]
                    : [
                        { value: 'WORKER', label: tr('requests.submittedByMe') },
                        { value: 'INCOMING', label: tr('requests.awaitingMyConsent') },
                      ]
                }
              />
              <Choice
                label={tr('requests.kind')}
                value={type}
                onChange={(v) => {
                  setType(v as typeof type);
                  setOffset(0);
                }}
                options={[
                  { value: 'ALL', label: t('common.all') },
                  { value: 'CHANGE', label: t('requests.changeShift') },
                  { value: 'SWAP', label: t('requests.swapRequest') },
                ]}
              />
            </Disclosure>
          )}

          <ErrorNotice error={command.error} />
          {detailId && <QueryState query={incoming}>{() => null}</QueryState>}
          {!rep && detail && renderDetail(detail)}
          <QueryState query={query}>
            {(data) => (
              <>
                {rep ? (
                  <ListHeading
                    title={t(view === 'HISTORY' ? 'requests.history' : 'requests.awaitingMyReview')}
                    count={t('contractorUi.requestCount', { count: data.total })}
                  />
                ) : (
                  <Hint>
                    {data.pendingCount} {tr('requests.pendingReviewUnit')} {data.incomingCount}{' '}
                    {tr('requests.pendingConsentUnit')}
                  </Hint>
                )}
                {!data.items.length &&
                  (rep ? (
                    <EmptyState
                      icon={<IconDocument size={26} color={colors.primary} />}
                      title={t('requests.noRequests')}
                      hint={t('contractorUi.requestEmptyHint')}
                    />
                  ) : (
                    <Hint>{t('requests.noRequests')}</Hint>
                  ))}
                {data.items.map((r) => {
                  const workerName =
                    r.requestType === 'SWAP'
                      ? `${getWorkerName(r.requesterWorkerId)} ↔ ${getWorkerName(r.coworkerWorkerId)}`
                      : getWorkerName(r.workerId);
                  if (rep)
                    return (
                      <Card key={r.id}>
                        <View style={schedStyles.repHeading}>
                          <Text style={schedStyles.repName}>{workerName}</Text>
                          <Text style={schedStyles.repBadge}>{localizedLabel(r.status)}</Text>
                        </View>
                        <Text style={schedStyles.repCaption}>
                          {t(
                            r.requestType === 'SWAP'
                              ? 'requests.swapRequest'
                              : 'requests.changeShift',
                          )}{' '}
                          ·{' '}
                          {r.requestType === 'SWAP'
                            ? (r.requesterWorkDate ?? '—') + ' ↔ ' + (r.coworkerWorkDate ?? '—')
                            : (r.workDate ?? '—')}
                        </Text>
                        <Text style={schedStyles.repShift}>
                          {r.requestType === 'SWAP'
                            ? getShiftLabel(r.requesterShiftId) +
                              ' ↔ ' +
                              getShiftLabel(r.coworkerShiftId)
                            : getShiftLabel(r.fromShiftId) + ' → ' + getShiftLabel(r.toShiftId)}
                        </Text>
                        {r.reason && (
                          <Text numberOfLines={2} style={schedStyles.repReason}>
                            {t('requests.reason')}: {r.reason}
                          </Text>
                        )}
                        <DetailLink
                          label={t('requests.viewRequest')}
                          onPress={() => {
                            setSelected(r);
                            setReason('');
                            command.reset();
                          }}
                        />
                      </Card>
                    );
                  const initials =
                    workerName
                      .split(' ')
                      .map((p) => p[0])
                      .filter(Boolean)
                      .slice(-2)
                      .join('')
                      .toUpperCase() || 'W';
                  const isApproved = r.status === 'APPROVED';
                  const isRejected = r.status === 'REJECTED';

                  return (
                    <View key={r.id} style={schedStyles.requestItemCard}>
                      <View style={schedStyles.requestItemHeader}>
                        <View
                          style={[
                            schedStyles.typePill,
                            { backgroundColor: r.requestType === 'SWAP' ? '#EFF6FF' : '#FFF4EE' },
                          ]}
                        >
                          <Text
                            style={[
                              schedStyles.typePillText,
                              { color: r.requestType === 'SWAP' ? '#2563EB' : '#F66B17' },
                            ]}
                          >
                            {r.requestType === 'SWAP'
                              ? t('requests.swapRequest')
                              : t('requests.changeShift')}
                          </Text>
                        </View>
                        <View
                          style={[
                            schedStyles.statusPill,
                            {
                              backgroundColor: isApproved
                                ? '#EDFAF2'
                                : isRejected
                                  ? '#FEE2E2'
                                  : '#FEF3C7',
                            },
                          ]}
                        >
                          <View
                            style={[
                              schedStyles.statusDot,
                              {
                                backgroundColor: isApproved
                                  ? '#10B981'
                                  : isRejected
                                    ? '#EF4444'
                                    : '#F59E0B',
                              },
                            ]}
                          />
                          <Text
                            style={[
                              schedStyles.statusPillText,
                              {
                                color: isApproved ? '#065F46' : isRejected ? '#DC2626' : '#B45309',
                              },
                            ]}
                          >
                            {localizedLabel(r.status)}
                          </Text>
                        </View>
                      </View>

                      <View style={schedStyles.workerRow}>
                        <View style={schedStyles.avatarCircle}>
                          <Text style={schedStyles.avatarText}>{initials}</Text>
                        </View>
                        <Text style={schedStyles.cardWorkerText}>{workerName}</Text>
                      </View>

                      <View style={schedStyles.cardShiftBox}>
                        <Text style={schedStyles.cardDateText}>
                          📅 {t('schedule.date')}:{' '}
                          <Text style={{ fontWeight: '700' }}>
                            {r.requestType === 'SWAP'
                              ? `${r.requesterWorkDate ?? '—'} ↔ ${r.coworkerWorkDate ?? '—'}`
                              : (r.workDate ?? '—')}
                          </Text>
                        </Text>
                        <Text style={schedStyles.shiftTransitionText} numberOfLines={1}>
                          {r.requestType === 'SWAP' ? (
                            <>
                              <Text style={schedStyles.shiftSourceText}>
                                {getShiftLabel(r.requesterShiftId)}
                              </Text>
                              {' ↔ '}
                              <Text style={schedStyles.shiftTargetText}>
                                {getShiftLabel(r.coworkerShiftId)}
                              </Text>
                            </>
                          ) : (
                            <>
                              <Text style={schedStyles.shiftSourceText}>
                                {getShiftLabel(r.fromShiftId)}
                              </Text>
                              {' → '}
                              <Text style={schedStyles.shiftTargetText}>
                                {getShiftLabel(r.toShiftId)}
                              </Text>
                            </>
                          )}
                        </Text>
                      </View>

                      {r.reason ? (
                        <Text
                          numberOfLines={rep ? 2 : undefined}
                          style={schedStyles.requestReasonText}
                        >
                          <Text style={{ fontWeight: '600', color: '#64748B' }}>
                            {t('schedule.reason')}:{' '}
                          </Text>
                          "{r.reason}"
                        </Text>
                      ) : null}

                      <Button
                        secondary
                        label={t('requests.viewRequest')}
                        onPress={() => {
                          setSelected(r);
                          setReason('');
                          command.reset();
                        }}
                      />
                    </View>
                  );
                })}
                {(!rep || data.total > pageSize) && (
                  <Pager offset={offset} total={data.total} size={pageSize} onChange={setOffset} />
                )}
              </>
            )}
          </QueryState>
        </>
      )}
      {rep && detailId && (
        <RequestSheet
          visible
          variant="form"
          icon={<IconDocument size={23} color={colors.primary} />}
          title={t('requests.viewRequest')}
          subtitle={t(detailKind === 'SWAP' ? 'requests.swapRequest' : 'requests.changeShift')}
          busy={command.isPending}
          onClose={() => {
            setSelected(null);
            setNotificationDismissed(true);
            setReason('');
            command.reset();
          }}
          footer={
            <QueryState query={incoming}>{(data) => renderDetail(data, 'footer')}</QueryState>
          }
        >
          <QueryState query={incoming}>{(data) => renderDetail(data)}</QueryState>
        </RequestSheet>
      )}
    </Page>
  );
}

const schedStyles = StyleSheet.create({
  repSubtitle: { fontSize: 12, lineHeight: 20, color: colors.textMuted, marginTop: -8 },
  repActions: { gap: 10 },
  repHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  repName: {
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  repBadge: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSubtle,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
    fontSize: 12,
    lineHeight: 18,
    overflow: 'hidden',
  },
  repCaption: { fontSize: 12, lineHeight: 20, color: colors.textMuted },
  repShift: { fontSize: 13, lineHeight: 21, color: colors.textSecondary },
  repReason: { fontSize: 14, lineHeight: 22, color: colors.textPrimary },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    gap: 4,
    flexShrink: 0,
    maxWidth: '100%',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexShrink: 0,
  },
  statusPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    maxWidth: '100%',
  },
  typePillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailWorkerText: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0F1E36',
  },
  shiftTransitionBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  shiftDateText: {
    fontSize: 13.5,
    color: '#475569',
  },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  shiftTransitionText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#334155',
  },
  shiftSourceText: {
    fontWeight: '600',
    color: '#475569',
  },
  shiftTargetText: {
    fontWeight: '700',
    color: '#F66B17',
  },
  reasonBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FFEDD5',
    gap: 4,
  },
  reasonLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#C2410C',
  },
  reasonContent: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#334155',
    lineHeight: 20,
  },
  detailInfoGrid: {
    gap: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  detailInfoSub: {
    fontSize: 13.5,
    color: '#94A3B8',
  },
  detailReviewReason: {
    fontSize: 13.5,
    color: '#475569',
    fontStyle: 'italic',
  },
  cardWorkerText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1E36',
  },
  cardShiftBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    gap: 4,
  },
  cardDateText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#64748B',
  },
  requestItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  requestItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  requestReasonText: {
    fontSize: 13.5,
    color: '#334155',
    fontStyle: 'italic',
    lineHeight: 20,
    backgroundColor: '#FFF7ED',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FFEDD5',
  },
  workerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFF4EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#EA580C',
  },
});
