import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../workspace/workspace-context';
import {
  allPages,
  displayTime,
  instant,
  localDate,
  minutes,
  required,
  useCommand,
  useRequestId,
  validDates,
} from '../shared/data';
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
import { DateTimeField } from '../shared/date-time-field';
import type { AttendanceSessionResponse, AttendanceDaysResponse } from '@smartsite/api-client';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { AttendanceReport } from './attendance-report';
import { colors } from '../../theme/colors';
import { useTranslation } from '../../i18n';
import {
  IconClock,
  IconAlert,
  IconChevronDown,
  IconChevronUp,
} from '../../components/common/Icons';

export function AttendanceScreen({
  initialDayId,
  onBack,
}: {
  initialDayId?: string;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey, workerId } = useWorkspace();
  const today = localDate(),
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`),
    [to, setTo] = useState(today),
    [range, setRange] = useState({ fromDate: from, toDate: to }),
    [offset, setOffset] = useState(0);
  const [dayId, setDayId] = useState(initialDayId ?? ''),
    [requestOpen, setRequestOpen] = useState(false),
    [error, setError] = useState<unknown>(null);
  const workers = useScopedWorkers();
  const workerIds = new Set(workers.data?.map((w) => w.id));

  const days = useQuery({
    queryKey: [...queryKey, 'attendance-days', range, offset],
    enabled: workers.isSuccess,
    queryFn: async ({ signal }) => {
      const pages: AttendanceDaysResponse[] = [];
      const rows = (
        await allPages(async (p) => {
          const result = await client.attendanceDays(token, scope.siteId, {
            ...range,
            ...p,
            ...(scope.role === 'worker' ? { workerId } : {}),
          });
          pages.push(result);
          return result;
        }, signal)
      ).filter((d) => workerIds.has(d.workerId));
      const first = pages[0]!;
      return {
        ...first,
        items: rows.slice(offset, offset + 20),
        total: rows.length,
        requests: first.requests.filter((r) => workerIds.has(r.workerId)),
        canRequest: scope.role === 'worker' && first.canRequest,
      };
    },
  });

  const summary = useQuery({
    queryKey: [...queryKey, 'attendance-summary', range],
    queryFn: () =>
      client.attendanceSummary(token, scope.siteId, {
        ...range,
        ...(scope.role === 'worker' ? { workerId } : {}),
        timezone,
        ...(scope.contractorId ? { contractorId: scope.contractorId } : {}),
      }),
  });

  const timesheets = useQuery({
    queryKey: [...queryKey, 'attendance-timesheets', range],
    enabled: workers.isSuccess,
    queryFn: async () => {
      const result = await client.attendanceTimesheets(token, scope.siteId, {
        ...range,
        ...(scope.role === 'worker' ? { workerId } : {}),
      });
      return { ...result, items: result.items.filter((w) => workerIds.has(w.workerId)) };
    },
  });

  if (dayId) return <AttendanceDetail dayId={dayId} onBack={() => setDayId('')} />;

  if (!workers.isSuccess)
    return (
      <Page title="Phạm vi công nhân" onBack={onBack}>
        <QueryState query={workers}>{() => null}</QueryState>
      </Page>
    );

  return (
    <Page
      title={scope.role === 'worker' ? t('attendance.myTitle') : t('attendance.teamTitle')}
      onBack={onBack}
    >
      {/* Date Filter Card */}
      <Card>
        <Field
          label={`${t('attendance.filterFrom')} (YYYY-MM-DD)`}
          value={from}
          onChangeText={setFrom}
        />
        <Field label={`${t('attendance.filterTo')} (YYYY-MM-DD)`} value={to} onChangeText={setTo} />
        <ErrorNotice error={error} />
        <Button
          secondary
          label={t('attendance.filter')}
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

      {/* 3-Column Summary Stats Card (Matching Lovable) */}
      <QueryState query={summary}>
        {(s) => (
          <View style={attStyles.summaryCard}>
            <View style={attStyles.summaryGrid}>
              <View style={attStyles.summaryCol}>
                <Text style={attStyles.summaryValueGreen}>{minutes(s.totalMinutes)}</Text>
                <Text style={attStyles.summaryLabel}>{t('attendance.confirmedHours')}</Text>
              </View>
              <View style={attStyles.colDivider} />
              <View style={attStyles.summaryCol}>
                <Text style={attStyles.summaryValueOrange}>{minutes(s.overtimeMinutes)}</Text>
                <Text style={attStyles.summaryLabel}>{t('attendance.overtime')}</Text>
              </View>
              <View style={attStyles.colDivider} />
              <View style={attStyles.summaryCol}>
                <Text style={attStyles.summaryValueBlue}>{minutes(s.provisionalMinutes)}</Text>
                <Text style={attStyles.summaryLabel}>{t('attendance.provisionalHours')}</Text>
              </View>
            </View>

            <View style={attStyles.summaryPillsRow}>
              <View style={[attStyles.miniPill, { backgroundColor: '#EDFAF2' }]}>
                <View style={[attStyles.miniDot, { backgroundColor: '#10B981' }]} />
                <Text style={[attStyles.miniPillText, { color: '#065F46' }]}>
                  {t('attendance.presentDaysCount', { count: s.presentDays })}
                </Text>
              </View>
              <View style={[attStyles.miniPill, { backgroundColor: '#F1F5F9' }]}>
                <View style={[attStyles.miniDot, { backgroundColor: '#64748B' }]} />
                <Text style={[attStyles.miniPillText, { color: '#475569' }]}>
                  {t('attendance.absentDaysCount', { count: s.absentDays })}
                </Text>
              </View>
              <View style={[attStyles.miniPill, { backgroundColor: '#FFF4EE' }]}>
                <View style={[attStyles.miniDot, { backgroundColor: '#F66B17' }]} />
                <Text style={[attStyles.miniPillText, { color: '#C2410C' }]}>
                  {t('attendance.reviewDaysCount', { count: s.reviewDays })}
                </Text>
              </View>
            </View>
          </View>
        )}
      </QueryState>

      {/* Days List & Requests */}
      <QueryState query={days}>
        {(data) => (
          <>
            {scope.role === 'worker' && data.canRequest && (
              <Button
                label={t('attendance.requestLeaveOrOvertime')}
                onPress={() => setRequestOpen(true)}
              />
            )}
            {!data.items.length && <Hint>{t('attendance.noDaysInRange')}</Hint>}
            {data.items.map((day) => (
              <View key={day.id} style={attStyles.dayCard}>
                <View style={attStyles.dayCardHeader}>
                  <View style={attStyles.dateBadge}>
                    <Text style={attStyles.dateBadgeDay}>{day.workDate.slice(8)}</Text>
                    <Text style={attStyles.dateBadgeMonth}>
                      Th{Number(day.workDate.slice(5, 7))}
                    </Text>
                  </View>
                  <View style={attStyles.dayInfoCol}>
                    <Text style={attStyles.dayWorkerName}>
                      {scope.role === 'contractor'
                        ? day.workerName
                        : (day.shiftName ?? t('attendance.shiftNotAssigned'))}
                    </Text>
                    <View style={attStyles.presenceBadge}>
                      <View
                        style={[
                          attStyles.miniDot,
                          { backgroundColor: day.presence === 'INSIDE' ? '#10B981' : '#F66B17' },
                        ]}
                      />
                      <Text
                        style={[
                          attStyles.presenceText,
                          { color: day.presence === 'INSIDE' ? '#065F46' : '#C2410C' },
                        ]}
                      >
                        {day.presence === 'INSIDE'
                          ? t('attendance.insideSite')
                          : t('attendance.outsideSite')}
                      </Text>
                    </View>
                  </View>
                  <View style={attStyles.dayHoursCol}>
                    <Text style={attStyles.hoursText}>
                      {day.confirmedMinutes === null
                        ? minutes(day.provisionalMinutes)
                        : minutes(day.confirmedMinutes)}
                    </Text>
                    <Text style={attStyles.hoursSub}>
                      {day.confirmedMinutes === null
                        ? t('attendance.provisionalHours')
                        : t('attendance.confirmedHours')}
                    </Text>
                  </View>
                </View>

                {day.anomalies.length > 0 && (
                  <View style={attStyles.anomaliesRow}>
                    {day.anomalies.map((a, i) => (
                      <View key={i} style={attStyles.anomalyPill}>
                        <Text style={attStyles.anomalyText}>⚠️ {a}</Text>
                      </View>
                    ))}
                  </View>
                )}

                <Button
                  secondary
                  label={t('attendance.dayDetail')}
                  onPress={() => setDayId(day.id)}
                />
              </View>
            ))}

            <Pager offset={offset} total={data.total} onChange={setOffset} />

            <Card>
              <Body>{t('attendance.requestsInRange')}</Body>
              {!data.requests.length && <Hint>{t('attendance.noRequests')}</Hint>}
              {data.requests.map((r) => (
                <Body key={r.id}>
                  {r.kind === 'LEAVE' ? t('attendance.leave') : t('attendance.overtime')} ·{' '}
                  {displayTime(r.startsAt)}–{displayTime(r.endsAt)} · {r.status}
                  {r.reviewNote ? ` · ${r.reviewNote}` : ''}
                </Body>
              ))}
            </Card>
          </>
        )}
      </QueryState>

      {/* Report & Timesheets */}
      <AttendanceReport
        key={`${range.fromDate}:${range.toDate}`}
        fromDate={range.fromDate}
        toDate={range.toDate}
        onDay={setDayId}
      />

      <QueryState query={timesheets}>
        {(data) => (
          <Card>
            <Body>{t('attendance.confirmedTimesheet')}</Body>
            {!data.items.length && <Hint>{t('attendance.noConfirmedHours')}</Hint>}
            {data.items.map((w) => (
              <Body key={w.workerId}>
                {w.workerName} · {w.confirmedDays} ngày · {minutes(w.totalMinutes)}
              </Body>
            ))}
          </Card>
        )}
      </QueryState>

      {/* Slide-up Modal: Gửi yêu cầu nghỉ / tăng ca */}
      <TimeRequestModal visible={requestOpen} onClose={() => setRequestOpen(false)} />
    </Page>
  );
}

function AttendanceDetail({ dayId, onBack }: { dayId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [session, setSession] = useState<AttendanceSessionResponse | null>(null);
  const [showRules, setShowRules] = useState(false);
  const workers = useScopedWorkers();

  const query = useQuery({
    queryKey: [...queryKey, 'day', dayId],
    queryFn: () => client.attendanceDayDetail(token, scope.siteId, dayId),
  });

  const overview = useQuery({
    queryKey: [...queryKey, 'corrections', dayId],
    queryFn: () => client.attendanceOverview(token, scope.siteId, { dayId }),
    enabled: !!query.data && !!workers.data?.some((w) => w.id === query.data?.day.workerId),
  });

  if (!workers.isSuccess)
    return (
      <Page title="Phạm vi công nhân" onBack={onBack}>
        <QueryState query={workers}>{() => null}</QueryState>
      </Page>
    );

  if (query.data && !workers.data.some((w) => w.id === query.data.day.workerId))
    return (
      <Page title="Ngoài phạm vi đang chọn" onBack={onBack}>
        <Hint>Chọn đúng công trường, nhà thầu hoặc vai trò để xem ngày công này.</Hint>
      </Page>
    );

  return (
    <Page title={t('attendance.dayDetail')} onBack={onBack}>
      <QueryState query={query}>
        {(data) => (
          <>
            {/* Header Stats Card */}
            <View style={attStyles.detailHeaderCard}>
              <View style={attStyles.detailTitleRow}>
                <View>
                  <Text style={attStyles.detailWorkerName}>{data.day.workerName}</Text>
                  <Text style={attStyles.detailSubInfo}>
                    {data.day.workDate} · {data.day.shiftName}
                  </Text>
                </View>
                <View style={attStyles.detailStatusBadge}>
                  <Text style={attStyles.detailStatusText}>{data.day.status}</Text>
                </View>
              </View>

              <View style={attStyles.detailStatsGrid}>
                <View style={attStyles.detailStatCol}>
                  <Text style={attStyles.detailStatNumGreen}>
                    {minutes(data.day.confirmedMinutes)}
                  </Text>
                  <Text style={attStyles.detailStatLabel}>{t('attendance.confirmedHours')}</Text>
                </View>
                <View style={attStyles.colDivider} />
                <View style={attStyles.detailStatCol}>
                  <Text style={attStyles.detailStatNumOrange}>
                    {minutes(data.day.overtimeMinutes)}
                  </Text>
                  <Text style={attStyles.detailStatLabel}>{t('attendance.overtime')}</Text>
                </View>
                <View style={attStyles.colDivider} />
                <View style={attStyles.detailStatCol}>
                  <Text style={attStyles.detailStatNumGray}>{data.day.exitCount ?? 0}</Text>
                  <Text style={attStyles.detailStatLabel}>{t('workerHome.gateExits')}</Text>
                </View>
              </View>
            </View>

            {/* Vertical Timeline of In/Out Sessions (Matching Lovable) */}
            <View style={attStyles.timelineSection}>
              <Text style={attStyles.sectionTitle}>{t('attendance.timeline')}</Text>
              {!data.sessions.length && <Hint>Chưa có phiên làm việc ghi nhận.</Hint>}
              {data.sessions.map((s, index) => {
                const isLast = index === data.sessions.length - 1;
                return (
                  <View key={s.id} style={attStyles.timelineRow}>
                    <View style={attStyles.timelineTrackCol}>
                      <View style={attStyles.timelineDot} />
                      {!isLast && <View style={attStyles.timelineTrackLine} />}
                    </View>

                    <View style={attStyles.sessionCard}>
                      <View style={attStyles.sessionCardHeader}>
                        <Text style={attStyles.sessionCardTitle}>
                          {t('attendance.sessionCount', { index: index + 1 })} · {s.status}
                        </Text>
                        <View style={attStyles.workedBadge}>
                          <Text style={attStyles.workedBadgeText}>{minutes(s.workedMinutes)}</Text>
                        </View>
                      </View>

                      <Text style={attStyles.sessionTimes}>
                        {displayTime(s.effectiveInAt ?? s.rawInAt)} →{' '}
                        {displayTime(s.effectiveOutAt ?? s.rawOutAt)}
                      </Text>
                      <Text style={attStyles.sessionRawTimes}>
                        {t('attendance.rawTime', {
                          in: displayTime(s.rawInAt),
                          out: displayTime(s.rawOutAt),
                        })}
                      </Text>

                      {scope.role === 'worker' &&
                        overview.data?.canRequestCorrection &&
                        !overview.data.hasPendingCorrection &&
                        s.status !== 'IGNORED_DUPLICATE' && (
                          <Button
                            secondary
                            label={t('attendance.requestSessionCorrection')}
                            onPress={() => setSession(s)}
                          />
                        )}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Collapsible Rules Card */}
            <View style={attStyles.rulesCard}>
              <Pressable style={attStyles.rulesHeader} onPress={() => setShowRules(!showRules)}>
                <Text style={attStyles.rulesTitle}>{t('attendance.rulesTitle')}</Text>
                {showRules ? (
                  <IconChevronUp size={18} color="#64748B" />
                ) : (
                  <IconChevronDown size={18} color="#64748B" />
                )}
              </Pressable>
              {showRules && (
                <Text style={attStyles.rulesContent}>{t('attendance.rulesContent')}</Text>
              )}
            </View>
          </>
        )}
      </QueryState>

      {/* Correction History */}
      <QueryState query={overview}>
        {(data) => (
          <Card>
            <Body>{t('attendance.correctionHistory')}</Body>
            {data.hasPendingCorrection && <Hint>{t('attendance.pendingCorrectionWarning')}</Hint>}
            {!data.corrections.length && <Hint>{t('attendance.noRequests')}</Hint>}
            {data.corrections.map((c) => (
              <Body key={c.id}>
                {c.reason} · {c.status} · {displayTime(c.proposedInAt)} →{' '}
                {displayTime(c.proposedOutAt)}
                {c.reviewNote ? ` · ${c.reviewNote}` : ''}
              </Body>
            ))}
          </Card>
        )}
      </QueryState>

      {/* Slide-up Modal: Yêu cầu sửa phiên công */}
      {session && (
        <CorrectionModal
          session={session}
          visible={Boolean(session)}
          onClose={() => setSession(null)}
        />
      )}
    </Page>
  );
}

function CorrectionModal({
  session,
  visible,
  onClose,
}: {
  session: AttendanceSessionResponse;
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { scope, client, token } = useWorkspace();
  const [from, setFrom] = useState(session.effectiveInAt ?? session.rawInAt ?? ''),
    [to, setTo] = useState(session.effectiveOutAt ?? session.rawOutAt ?? ''),
    [reason, setReason] = useState('');
  const command = useCommand(),
    requestId = useRequestId();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={attStyles.modalOverlay}
      >
        <Pressable style={attStyles.modalBackdrop} onPress={onClose} />
        <View style={attStyles.modalSheet}>
          <View style={attStyles.modalDragHandle} />
          <Text style={attStyles.modalTitle}>{t('attendance.requestSessionCorrection')}</Text>
          <Text style={attStyles.modalSubtitle}>
            Sự kiện quét gốc được giữ nguyên. Site Manager xét duyệt yêu cầu.
          </Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <DateTimeField label="Giờ vào đề nghị" value={from} onChange={setFrom} />
            <DateTimeField label="Giờ ra đề nghị" value={to} onChange={setTo} />
            <Field label="Lý do sửa công" multiline value={reason} onChangeText={setReason} />
            <ErrorNotice error={command.error} />

            <View style={{ marginTop: 16 }}>
              <Button
                label="Gửi Site Manager"
                disabled={command.isPending || !from || !to || !reason.trim()}
                onPress={() =>
                  command.mutate(async () => {
                    const proposedInAt = instant(from),
                      proposedOutAt = instant(to);
                    if (proposedOutAt <= proposedInAt) throw new Error('Giờ ra phải sau giờ vào.');
                    const input = {
                      expectedSessionVersion: session.version,
                      proposedInAt,
                      proposedOutAt,
                      reason: required(reason, 'lý do'),
                    };
                    await client.requestAttendanceCorrection(token, scope.siteId, session.id, {
                      ...input,
                      requestId: requestId(input),
                    });
                    onClose();
                  })
                }
              />
              <Button secondary label={t('common.cancel')} onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TimeRequestModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey, workerId } = useWorkspace();
  const [kind, setKind] = useState<'LEAVE' | 'OVERTIME'>('LEAVE'),
    [scheduleId, setSchedule] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [reason, setReason] = useState('');
  const command = useCommand(),
    requestId = useRequestId();

  const schedules = useQuery({
    queryKey: [...queryKey, 'request-schedules'],
    queryFn: ({ signal }) =>
      allPages(
        (p) =>
          client.listWorkerSchedules(token, scope.siteId, { ...p, status: 'ACTIVE', workerId }),
        signal,
      ),
    enabled: visible,
  });

  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) => allPages((p) => client.listShifts(token, scope.siteId, p), signal),
    enabled: visible,
  });

  const history = useQuery({
    queryKey: [...queryKey, 'time-requests', kind],
    queryFn: ({ signal }) =>
      allPages(
        (p) => client.attendanceTimeRequests(token, scope.siteId, { ...p, kind, workerId }),
        signal,
      ),
    enabled: visible,
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={attStyles.modalOverlay}
      >
        <Pressable style={attStyles.modalBackdrop} onPress={onClose} />
        <View style={attStyles.modalSheet}>
          <View style={attStyles.modalDragHandle} />
          <Text style={attStyles.modalTitle}>{t('attendance.requestLeaveOrOvertime')}</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Choice
              label="Loại yêu cầu"
              value={kind}
              onChange={(v) => {
                setKind(v as typeof kind);
                command.reset();
              }}
              options={[
                { value: 'LEAVE', label: 'Nghỉ trong ca' },
                { value: 'OVERTIME', label: 'Tăng ca ngoài giờ' },
              ]}
            />
            <QueryState query={shifts}>
              {() => (
                <QueryState query={schedules}>
                  {(data) => (
                    <Choice
                      label="Ca được phân công"
                      value={scheduleId}
                      onChange={setSchedule}
                      options={data.map((s) => ({
                        value: s.id,
                        label: `${s.workDate} · ${shifts.data?.find((v) => v.id === s.shiftId)?.name ?? 'Ca làm'}`,
                      }))}
                    />
                  )}
                </QueryState>
              )}
            </QueryState>

            <DateTimeField label="Bắt đầu" value={from} onChange={setFrom} />
            <DateTimeField label="Kết thúc" value={to} onChange={setTo} />
            <Hint>
              {kind === 'LEAVE'
                ? 'Thời gian nghỉ phải nằm trong ca được phân công.'
                : 'Gửi trước khi tăng ca bắt đầu, ngoài giờ ca chính.'}
            </Hint>
            <Field label="Lý do" value={reason} onChangeText={setReason} multiline />
            <ErrorNotice error={command.error} />

            <View style={{ marginTop: 12 }}>
              <Button
                label="Gửi Site Manager"
                disabled={command.isPending || !scheduleId || !from || !to || !reason.trim()}
                onPress={() =>
                  command.mutate(async () => {
                    const startsAt = instant(from),
                      endsAt = instant(to);
                    if (endsAt <= startsAt) throw new Error('Thời gian kết thúc phải sau bắt đầu.');
                    if (kind === 'OVERTIME' && Date.parse(startsAt) <= Date.now())
                      throw new Error('Tăng ca phải được yêu cầu trước giờ bắt đầu.');
                    const input = {
                      workerScheduleId: scheduleId,
                      kind,
                      startsAt,
                      endsAt,
                      reason: required(reason, 'lý do'),
                    };
                    await client.requestAttendanceTime(token, scope.siteId, {
                      ...input,
                      requestId: requestId(input),
                    });
                    onClose();
                  })
                }
              />
              <Button secondary label={t('common.cancel')} onPress={onClose} />
            </View>

            <QueryState query={history}>
              {(data) => (
                <View style={{ marginTop: 16 }}>
                  <Text style={attStyles.sectionTitle}>Lịch sử yêu cầu</Text>
                  {!data.length && <Hint>Chưa có yêu cầu.</Hint>}
                  {data.map((r) => (
                    <Text key={r.id} style={attStyles.historyRowText}>
                      {displayTime(r.startsAt)}–{displayTime(r.endsAt)} · {r.status} · {r.reason}
                    </Text>
                  ))}
                </View>
              )}
            </QueryState>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const attStyles = StyleSheet.create({
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
  },
  colDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#E2E8F0',
  },
  summaryValueGreen: {
    fontSize: 20,
    fontWeight: '800',
    color: '#10B981',
  },
  summaryValueOrange: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F66B17',
  },
  summaryValueBlue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#2563EB',
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 4,
  },
  summaryPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  miniPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 5,
  },
  miniDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  miniPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  dayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  dayCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dateBadge: {
    backgroundColor: '#FFF4EE',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 46,
  },
  dateBadgeDay: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F66B17',
  },
  dateBadgeMonth: {
    fontSize: 10,
    fontWeight: '700',
    color: '#C2410C',
    textTransform: 'uppercase',
  },
  dayInfoCol: {
    flex: 1,
    gap: 4,
  },
  dayWorkerName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F1E36',
  },
  presenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  presenceText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dayHoursCol: {
    alignItems: 'flex-end',
  },
  hoursText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
  },
  hoursSub: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '500',
  },
  anomaliesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  anomalyPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  anomalyText: {
    fontSize: 11,
    color: '#92400E',
    fontWeight: '600',
  },
  detailHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    gap: 14,
  },
  detailTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  detailWorkerName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
  },
  detailSubInfo: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  detailStatusBadge: {
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  detailStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  detailStatsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  detailStatCol: {
    flex: 1,
    alignItems: 'center',
  },
  detailStatNumGreen: {
    fontSize: 17,
    fontWeight: '800',
    color: '#10B981',
  },
  detailStatNumOrange: {
    fontSize: 17,
    fontWeight: '800',
    color: '#F66B17',
  },
  detailStatNumGray: {
    fontSize: 17,
    fontWeight: '800',
    color: '#64748B',
  },
  detailStatLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    marginTop: 2,
  },
  timelineSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 12,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timelineTrackCol: {
    alignItems: 'center',
    width: 20,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F66B17',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#F66B17',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
  },
  timelineTrackLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  sessionCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#EFF2F6',
    gap: 8,
  },
  sessionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
  },
  workedBadge: {
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  workedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  sessionTimes: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F1E36',
  },
  sessionRawTimes: {
    fontSize: 11,
    color: '#94A3B8',
  },
  rulesCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
  },
  rulesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rulesTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  rulesContent: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    paddingTop: 12,
    maxHeight: '85%',
  },
  modalDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
  },
  historyRowText: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 6,
  },
});
