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
import { allPages, displayTime, localDate, required, useCommand, validDates } from '../shared/data';
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
} from '../shared/ui';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useTranslation } from '../../i18n';
import { IconBriefcase } from '../../components/common/Icons';
import { colors } from '../../theme/colors';

export function ScheduleScreen({ initialDate }: { initialDate?: string }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey, workerId } = useWorkspace();
  const [today] = useState(() => localDate());
  const [from, setFrom] = useState(() => initialDate ?? localDate()),
    [to, setTo] = useState(() => initialDate ?? localDate(new Date(Date.now() + 30 * 86400000)));
  const [range, setRange] = useState({ fromDate: from, toDate: to }),
    [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<WorkerScheduleResponse | null>(null),
    [error, setError] = useState<unknown>(null);
  const schedules = useQuery({
    queryKey: [...queryKey, 'schedules', range, offset],
    queryFn: () =>
      client.listWorkerSchedules(token, scope.siteId, {
        ...range,
        offset,
        limit: 20,
        status: 'ALL',
        ...(scope.role === 'worker' ? { workerId } : {}),
        ...(scope.contractorId ? { contractorId: scope.contractorId } : {}),
      }),
  });
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) => allPages((p) => client.listShifts(token, scope.siteId, p), signal),
  });
  const workers = useScopedWorkers();
  if (selected)
    return (
      <ScheduleRequest
        key={selected.id}
        schedule={selected}
        shift={shifts.data?.find((s) => s.id === selected.shiftId)}
        onBack={() => setSelected(null)}
      />
    );
  const baseDate = new Date(from);
  const dayIndex = isNaN(baseDate.getTime()) ? 0 : (baseDate.getDay() + 6) % 7;
  const monday = new Date(isNaN(baseDate.getTime()) ? today : baseDate);
  monday.setDate(monday.getDate() - dayIndex);

  const dayLabels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    return {
      label: dayLabels[i],
      dateNumber: d.getDate(),
      dateStr,
      isSelected: dateStr === from,
    };
  });

  return (
    <Page
      title={scope.role === 'worker' ? t('schedule.title') : t('contractorHome.assignSchedule')}
    >
      {/* Week Calendar Strip (Matching Lovable) */}
      <View style={schedStyles.weekCard}>
        <View style={schedStyles.weekDaysRow}>
          {weekDays.map((d) => (
            <Pressable
              key={d.dateStr}
              accessibilityRole="button"
              accessibilityLabel={`${d.label} ${d.dateNumber}`}
              style={[schedStyles.dayCol, d.isSelected && schedStyles.dayColSelected]}
              onPress={() => {
                setFrom(d.dateStr);
                setTo(d.dateStr);
                setRange({ fromDate: d.dateStr, toDate: d.dateStr });
                setOffset(0);
              }}
            >
              <Text style={[schedStyles.dayName, d.isSelected && schedStyles.dayNameSelected]}>
                {d.label}
              </Text>
              <Text style={[schedStyles.dayDate, d.isSelected && schedStyles.dayDateSelected]}>
                {d.dateNumber}
              </Text>
              {d.isSelected ? (
                <View style={schedStyles.selectedDot} />
              ) : (
                <View style={{ height: 5 }} />
              )}
            </Pressable>
          ))}
        </View>
      </View>

      <Card>
        <Field
          label={`${t('schedule.fromDate')} (YYYY-MM-DD)`}
          value={from}
          onChangeText={setFrom}
        />
        <Field label={`${t('schedule.toDate')} (YYYY-MM-DD)`} value={to} onChangeText={setTo} />
        <ErrorNotice error={error} />
        <Button
          secondary
          label={t('schedule.search')}
          onPress={() => {
            try {
              validDates(from, to);
              setRange({ fromDate: from, toDate: to });
              setOffset(0);
              setError(null);
            } catch (e) {
              setError(e);
            }
          }}
        />
      </Card>
      <QueryState query={shifts}>
        {() => (
          <QueryState query={workers}>
            {() => (
              <QueryState query={schedules}>
                {(data) => (
                  <>
                    {!data.items.length && <Hint>{t('schedule.noSchedules')}</Hint>}
                    {data.items
                      .filter((s) => scope.role !== 'worker' || s.workerId === workerId)
                      .map((s) => {
                        const shift = shifts.data?.find((v) => v.id === s.shiftId);
                        const worker = workers.data?.find((v) => v.id === s.workerId);
                        return (
                          <Card key={s.id}>
                            <View style={schedStyles.shiftItemRow}>
                              <View style={[schedStyles.iconBox, { backgroundColor: '#FFF4EE' }]}>
                                <IconBriefcase size={22} color={colors.primary} />
                              </View>
                              <View style={schedStyles.shiftDetailsCol}>
                                <Text style={schedStyles.shiftTypeTitle}>
                                  {shift?.name ?? t('schedule.shift')}
                                </Text>
                                <Text style={schedStyles.shiftTimeText}>
                                  {shift
                                    ? `${displayTime(shift.startsAt)} – ${displayTime(shift.endsAt)}`
                                    : s.workDate}
                                </Text>
                                <Text style={schedStyles.shiftLocationText}>
                                  📍 {scope.siteName} · {worker?.displayName ?? s.workerId}
                                </Text>
                              </View>
                              <View
                                style={[
                                  schedStyles.statusPill,
                                  { backgroundColor: s.isActive ? '#EDFAF2' : '#F1F5F9' },
                                ]}
                              >
                                <Text
                                  style={[
                                    schedStyles.statusText,
                                    { color: s.isActive ? '#065F46' : '#64748B' },
                                  ]}
                                >
                                  {s.isActive
                                    ? t('workforce.statusActive')
                                    : t('workforce.statusInactive')}
                                </Text>
                              </View>
                            </View>
                            {scope.role === 'worker' && s.isActive && (
                              <Button
                                secondary
                                label={t('schedule.requestAction')}
                                onPress={() => setSelected(s)}
                              />
                            )}
                          </Card>
                        );
                      })}
                    <Pager offset={offset} total={data.total} onChange={setOffset} />
                  </>
                )}
              </QueryState>
            )}
          </QueryState>
        )}
      </QueryState>
      {scope.role === 'contractor' && (
        <Hint>
          Lịch được Site Manager gán. Đại diện xem lịch và duyệt đổi ca/hoán đổi trong mục Yêu cầu.
        </Hint>
      )}
    </Page>
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
  const [kind, setKind] = useState('CHANGE'),
    [target, setTarget] = useState(''),
    [reason, setReason] = useState('');
  const command = useCommand();
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
                  label: `${s.name} · ${displayTime(s.startsAt)}–${displayTime(s.endsAt)}`,
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
            ? 'Người nhận cần đồng ý trước khi Đại diện nhà thầu xét duyệt.'
            : kind === 'CHANGE'
              ? 'Đại diện nhà thầu xét duyệt đổi ca.'
              : 'Site Manager xét duyệt nghỉ nguyên ca.'}
        </Hint>
        <ErrorNotice error={command.error} />
        <Button
          label={command.isPending ? t('requests.sending') : t('requests.submitRequest')}
          disabled={command.isPending || !reason.trim() || (kind !== 'ABSENCE' && !target)}
          onPress={() =>
            command.mutate(async () => {
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
                });
              onBack();
            })
          }
        />
      </Card>
    </Page>
  );
}
export function ShiftRequestsScreen({
  initialId,
  initialKind,
  onBack,
}: {
  initialId?: string;
  initialKind?: string;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token, user, queryKey } = useWorkspace();
  const rep = scope.role === 'contractor';
  const [view, setView] = useState<ShiftRequestListOptions['view']>(rep ? 'REVIEW' : 'WORKER'),
    [type, setType] = useState<'ALL' | 'CHANGE' | 'SWAP'>('ALL'),
    [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ShiftRequestResponse | null>(null),
    [reason, setReason] = useState('');
  const command = useCommand();
  const workers = useScopedWorkers();
  const workerIds = new Set(workers.data?.map((w) => w.id));
  const query = useQuery({
    queryKey: [...queryKey, 'shift-requests', view, type, offset],
    enabled: workers.isSuccess,
    queryFn: async ({ signal }) => {
      const rows = (
        await allPages(
          (p) => client.listShiftRequests(token, scope.siteId, { view, requestType: type, ...p }),
          signal,
        )
      ).filter((r) => requestInScope(r, workerIds, scope.role));
      return {
        items: rows.slice(offset, offset + 20),
        total: rows.length,
        pendingCount: rows.filter((r) => r.status === 'PENDING_MANAGER').length,
        incomingCount: rows.filter((r) => r.status === 'PENDING_COWORKER').length,
      };
    },
    refetchInterval: 15000,
  });
  const incoming = useQuery({
    queryKey: [...queryKey, 'request-from-notification', initialId, initialKind],
    enabled: !!initialId,
    queryFn: async (): Promise<ShiftRequestResponse> =>
      initialKind === 'SWAP'
        ? {
            ...(await client.getShiftSwapRequest(token, scope.siteId, initialId!)),
            requestType: 'SWAP',
          }
        : {
            ...(await client.getShiftChangeRequest(token, scope.siteId, initialId!)),
            requestType: 'CHANGE',
          },
  });
  const team = useQuery({
    queryKey: [...queryKey, 'my-team'],
    queryFn: () => client.myContractorTeam(token, scope.siteId),
    enabled: !rep,
  });
  const absence = useQuery({
    queryKey: [...queryKey, 'absence-requests'],
    queryFn: ({ signal }) =>
      allPages((p) => client.listAbsenceRequests(token, scope.siteId, p), signal),
    enabled: !rep,
  });
  const detail = selected ?? incoming.data;
  const renderDetail = (r: ShiftRequestResponse) => {
    if (!requestInScope(r, workerIds, scope.role))
      return <Hint>Yêu cầu không thuộc phạm vi đang chọn.</Hint>;
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
        } else throw new Error('Yêu cầu không còn ở trạng thái cho phép xử lý.');
        setSelected(null);
        setReason('');
      });
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
              {r.status}
            </Text>
          </View>
        </View>

        <Text style={schedStyles.detailReasonText}>{r.reason}</Text>

        <View style={schedStyles.detailInfoGrid}>
          <Text style={schedStyles.detailInfoLine}>
            📅 {t('schedule.date')}:{' '}
            {r.requestType === 'SWAP'
              ? `${r.requesterWorkDate ?? '—'} ↔ ${r.coworkerWorkDate ?? '—'}`
              : (r.workDate ?? '—')}
          </Text>
          <Text style={schedStyles.detailInfoSub}>
            Gửi: {displayTime(r.createdAt)} · Xét: {displayTime(r.reviewedAt)}
          </Text>
          {r.reviewReason && (
            <Text style={schedStyles.detailReviewReason}>Lý do xét: {r.reviewReason}</Text>
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
  if (!workers.isSuccess)
    return (
      <Page title="Phạm vi công nhân" onBack={onBack}>
        <QueryState query={workers}>{() => null}</QueryState>
      </Page>
    );
  return (
    <Page title={rep ? t('contractorHome.approveRequests') : t('requests.title')} onBack={onBack}>
      <Choice
        label="Danh sách"
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
                { value: 'REVIEW', label: 'Chờ tôi xét duyệt' },
                { value: 'HISTORY', label: 'Lịch sử' },
              ]
            : [
                { value: 'WORKER', label: 'Tôi đã gửi' },
                { value: 'INCOMING', label: 'Chờ tôi đồng ý' },
              ]
        }
      />
      <Choice
        label="Loại"
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
      <ErrorNotice error={command.error} />
      {initialId && <QueryState query={incoming}>{() => null}</QueryState>}
      {detail && renderDetail(detail)}
      <QueryState query={query}>
        {(data) => (
          <>
            <Hint>
              {data.pendingCount} yêu cầu chờ duyệt · {data.incomingCount} yêu cầu chờ đồng ý
            </Hint>
            {!data.items.length && <Hint>{t('requests.noRequests')}</Hint>}
            {data.items.map((r) => (
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
                        backgroundColor:
                          r.status === 'APPROVED'
                            ? '#EDFAF2'
                            : r.status === 'REJECTED'
                              ? '#FEE2E2'
                              : '#FEF3C7',
                      },
                    ]}
                  >
                    <View
                      style={[
                        schedStyles.statusDot,
                        {
                          backgroundColor:
                            r.status === 'APPROVED'
                              ? '#10B981'
                              : r.status === 'REJECTED'
                                ? '#EF4444'
                                : '#F59E0B',
                        },
                      ]}
                    />
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
                      {r.status}
                    </Text>
                  </View>
                </View>

                <Text style={schedStyles.requestReasonText}>{r.reason}</Text>

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
            ))}
            <Pager offset={offset} total={data.total} onChange={setOffset} />
          </>
        )}
      </QueryState>
      {!rep && (
        <QueryState query={absence}>
          {(data) => (
            <Card>
              <Body>{t('requests.leaveRequest')}</Body>
              {!data.length && <Hint>{t('requests.noRequests')}</Hint>}
              {data.map((r) => (
                <Body key={r.id}>
                  {r.reason} · {r.status}
                </Body>
              ))}
            </Card>
          )}
        </QueryState>
      )}
    </Page>
  );
}

const schedStyles = StyleSheet.create({
  weekCard: {
    backgroundColor: '#F8F9FB',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#EFF2F6',
    marginBottom: 4,
  },
  weekDaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dayCol: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    marginHorizontal: 2,
  },
  dayColSelected: {
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  dayName: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '600',
    marginBottom: 4,
  },
  dayNameSelected: {
    color: '#FFFFFF',
  },
  dayDate: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  dayDateSelected: {
    color: '#FFFFFF',
  },
  selectedDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#FFFFFF',
  },
  shiftItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shiftDetailsCol: {
    flex: 1,
  },
  shiftTypeTitle: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
    marginBottom: 2,
  },
  shiftTimeText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F1E36',
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  shiftLocationText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
  },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  typePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  detailReasonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
  },
  detailInfoGrid: {
    gap: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  detailInfoLine: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  detailInfoSub: {
    fontSize: 12,
    color: '#94A3B8',
  },
  detailReviewReason: {
    fontSize: 12,
    color: '#475569',
    fontStyle: 'italic',
  },
  requestItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  requestItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  requestReasonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
    lineHeight: 20,
  },
});
