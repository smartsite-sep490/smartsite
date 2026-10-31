import { localizedLabel } from '../../i18n/messages';
import { translate as tr, uiLocale } from '../../i18n';
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
import { useTranslation } from '../../i18n';
import { IconChevronDown, IconChevronUp, IconChevronRight } from '../../components/common/Icons';
import { DateRangeFilter } from '../shared/date-range-filter';

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
  const [range, setRange] = useState({ fromDate: `${today.slice(0, 8)}01`, toDate: today }),
    [offset, setOffset] = useState(0);
  const [dayId, setDayId] = useState(initialDayId ?? ''),
    [requestOpen, setRequestOpen] = useState(false);
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
      <Page title={tr('attendance.workerScope')} onBack={onBack}>
        <QueryState query={workers}>{() => null}</QueryState>
      </Page>
    );

  return (
    <Page
      title={scope.role === 'worker' ? t('attendance.myTitle') : t('attendance.teamTitle')}
      onBack={onBack}
    >
      {/* Draggable / Swipeable Date Range Filter */}
      <DateRangeFilter
        range={range}
        onChange={(newRange) => {
          setRange(newRange);
          setOffset(0);
        }}
        onValidate={(newRange) => validDates(newRange.fromDate, newRange.toDate)}
      />

      {/* 3-Column Summary Stats Card */}
      <QueryState query={summary}>
        {(s) => (
          <View style={attStyles.summaryCard}>
            <Text style={attStyles.summaryCardTitle}>{t('attendance.overview')}</Text>
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
              <Pressable
                key={day.id}
                accessibilityRole="button"
                accessibilityLabel={`${day.workDate} ${scope.role === 'contractor' ? day.workerName : (day.shiftName ?? t('attendance.shiftNotAssigned'))}`}
                style={({ pressed }) => [attStyles.dayCard, pressed && { opacity: 0.92 }]}
                onPress={() => setDayId(day.id)}
              >
                <View style={attStyles.dayCardHeader}>
                  <View style={attStyles.dateBadge}>
                    <Text style={attStyles.dateBadgeDay}>{day.workDate.slice(8)}</Text>
                    <Text style={attStyles.dateBadgeMonth}>
                      {new Intl.DateTimeFormat(uiLocale(), {
                        month: 'short',
                        timeZone: 'UTC',
                      }).format(new Date(`${day.workDate}T00:00:00Z`))}
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

                <View style={attStyles.dayCardFooter}>
                  <Text style={attStyles.dayDetailLink}>{t('attendance.dayDetail')}</Text>
                  <IconChevronRight size={18} color="#F66B17" />
                </View>
              </Pressable>
            ))}

            <Pager offset={offset} total={data.total} onChange={setOffset} />

            <Card>
              <Body>{t('attendance.requestsInRange')}</Body>
              {!data.requests.length && <Hint>{t('attendance.noRequests')}</Hint>}
              {data.requests.map((r) => (
                <Body key={r.id}>
                  {r.kind === 'LEAVE' ? t('attendance.leave') : t('attendance.overtime')} ·{' '}
                  {displayTime(r.startsAt)}–{displayTime(r.endsAt)} · {localizedLabel(r.status)}
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
                {w.workerName} · {w.confirmedDays} {tr('attendance.daysSeparator')}{' '}
                {minutes(w.totalMinutes)}
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
      <Page title={tr('attendance.workerScope')} onBack={onBack}>
        <QueryState query={workers}>{() => null}</QueryState>
      </Page>
    );

  if (query.data && !workers.data.some((w) => w.id === query.data.day.workerId))
    return (
      <Page title={tr('attendance.outOfScope')} onBack={onBack}>
        <Hint>{tr('attendance.scopeHint')}</Hint>
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
                <View style={{ flex: 1, minWidth: 140 }}>
                  <Text style={attStyles.detailWorkerName}>{data.day.workerName}</Text>
                  <Text style={attStyles.detailSubInfo}>
                    {data.day.workDate} · {data.day.shiftName}
                  </Text>
                </View>
                <View style={attStyles.detailStatusBadge}>
                  <Text style={attStyles.detailStatusText}>{localizedLabel(data.day.status)}</Text>
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
              {!data.sessions.length && <Hint>{tr('attendance.noSessions')}</Hint>}
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
                          {t('attendance.sessionCount', { index: index + 1 })} ·{' '}
                          {localizedLabel(s.status)}
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
                {c.reason} · {localizedLabel(c.status)} · {displayTime(c.proposedInAt)} →{' '}
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
          <Text style={attStyles.modalSubtitle}>{tr('attendance.correctionHint')}</Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <DateTimeField label={tr('attendance.proposedIn')} value={from} onChange={setFrom} />
            <DateTimeField label={tr('attendance.proposedOut')} value={to} onChange={setTo} />
            <Field
              label={tr('attendance.correctionReason')}
              multiline
              value={reason}
              onChangeText={setReason}
            />
            <ErrorNotice error={command.error} />

            <View style={{ marginTop: 16 }}>
              <Button
                label={tr('attendance.submitToManager')}
                disabled={command.isPending || !from || !to || !reason.trim()}
                onPress={() =>
                  command.mutate(async () => {
                    const proposedInAt = instant(from),
                      proposedOutAt = instant(to);
                    if (proposedOutAt <= proposedInAt)
                      throw new Error(tr('validation.exitAfterEntry'));
                    const input = {
                      expectedSessionVersion: session.version,
                      proposedInAt,
                      proposedOutAt,
                      reason: required(reason, tr('validation.reasonLabel')),
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
              label={tr('schedule.requestType')}
              value={kind}
              onChange={(v) => {
                setKind(v as typeof kind);
                command.reset();
              }}
              options={[
                { value: 'LEAVE', label: tr('attendance.partialLeave') },
                { value: 'OVERTIME', label: tr('attendance.overtimeOutsideShift') },
              ]}
            />
            <QueryState query={shifts}>
              {() => (
                <QueryState query={schedules}>
                  {(data) => (
                    <Choice
                      label={tr('attendance.assignedShift')}
                      value={scheduleId}
                      onChange={setSchedule}
                      options={data.map((s) => ({
                        value: s.id,
                        label: `${s.workDate} · ${shifts.data?.find((v) => v.id === s.shiftId)?.name ?? tr('schedule.shift')}`,
                      }))}
                    />
                  )}
                </QueryState>
              )}
            </QueryState>

            <DateTimeField label={tr('common.start')} value={from} onChange={setFrom} />
            <DateTimeField label={tr('common.end')} value={to} onChange={setTo} />
            <Hint>
              {kind === 'LEAVE'
                ? tr('attendance.leaveBoundsHint')
                : tr('attendance.overtimeBoundsHint')}
            </Hint>
            <Field
              label={tr('requests.reason')}
              value={reason}
              onChangeText={setReason}
              multiline
            />
            <ErrorNotice error={command.error} />

            <View style={{ marginTop: 12 }}>
              <Button
                label={tr('attendance.submitToManager')}
                disabled={command.isPending || !scheduleId || !from || !to || !reason.trim()}
                onPress={() =>
                  command.mutate(async () => {
                    const startsAt = instant(from),
                      endsAt = instant(to);
                    if (endsAt <= startsAt) throw new Error(tr('validation.timeEndAfterStart'));
                    if (kind === 'OVERTIME' && Date.parse(startsAt) <= Date.now())
                      throw new Error(tr('validation.overtimeBeforeStart'));
                    const input = {
                      workerScheduleId: scheduleId,
                      kind,
                      startsAt,
                      endsAt,
                      reason: required(reason, tr('validation.reasonLabel')),
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
                  <Text style={attStyles.sectionTitle}>{tr('attendance.requestHistory')}</Text>
                  {!data.length && <Hint>{tr('attendance.noRequests')}</Hint>}
                  {data.map((r) => (
                    <Text key={r.id} style={attStyles.historyRowText}>
                      {displayTime(r.startsAt)}–{displayTime(r.endsAt)} · {localizedLabel(r.status)}{' '}
                      · {r.reason}
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
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    gap: 12,
  },
  summaryCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F1E36',
    marginBottom: 2,
  },
  summaryGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
    paddingHorizontal: 4,
  },
  colDivider: {
    width: 1,
    height: 38,
    backgroundColor: '#E2E8F0',
  },
  summaryValueGreen: {
    fontSize: 24,
    fontWeight: '800',
    color: '#10B981',
  },
  summaryValueOrange: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F66B17',
  },
  summaryValueBlue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2563EB',
  },
  summaryLabel: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#475569',
    marginTop: 4,
    textAlign: 'center',
    lineHeight: 19,
  },
  summaryPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  miniPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 6,
  },
  miniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  miniPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  dayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  dayCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  dateBadge: {
    backgroundColor: '#FFF4EE',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 54,
    flexShrink: 0,
  },
  dateBadgeDay: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F66B17',
  },
  dateBadgeMonth: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#C2410C',
    textTransform: 'uppercase',
  },
  dayInfoCol: {
    flex: 1,
    gap: 5,
    minWidth: 100,
    flexBasis: 120,
  },
  dayWorkerName: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0F1E36',
    lineHeight: 24,
  },
  presenceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  presenceText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  dayHoursCol: {
    alignItems: 'flex-end',
    gap: 2,
    maxWidth: '100%',
  },
  hoursText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F1E36',
  },
  hoursSub: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  anomaliesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  anomalyPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  anomalyText: {
    fontSize: 13,
    color: '#92400E',
    fontWeight: '700',
  },
  dayCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F5F9',
  },
  dayDetailLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F66B17',
  },
  detailHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 14,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  detailTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 10,
  },
  detailWorkerName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F1E36',
  },
  detailSubInfo: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  detailStatusBadge: {
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  detailStatusText: {
    fontSize: 13,
    fontWeight: '800',
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
    fontSize: 20,
    fontWeight: '800',
    color: '#10B981',
  },
  detailStatNumOrange: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F66B17',
  },
  detailStatNumGray: {
    fontSize: 20,
    fontWeight: '800',
    color: '#64748B',
  },
  detailStatLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },
  timelineSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
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
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
    shadowColor: '#0F1E36',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  sessionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  sessionCardTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: '#0F1E36',
    flexShrink: 1,
    lineHeight: 22,
  },
  workedBadge: {
    backgroundColor: '#EDFAF2',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
  },
  workedBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#065F46',
  },
  sessionTimes: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
  },
  sessionRawTimes: {
    fontSize: 13,
    color: '#64748B',
  },
  rulesCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  rulesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rulesTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#334155',
  },
  rulesContent: {
    fontSize: 13.5,
    color: '#64748B',
    lineHeight: 20,
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
    fontSize: 14,
    color: '#64748B',
    marginBottom: 14,
  },
  historyRowText: {
    fontSize: 13.5,
    color: '#334155',
    marginBottom: 6,
  },
});
