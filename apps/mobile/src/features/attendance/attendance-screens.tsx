import { localizedLabel } from '../../i18n/messages';
import { translate as tr, uiLocale } from '../../i18n';
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, displayTime, localDate, minutes, validDates } from '../shared/data';
import { Body, Button, CompactTabs, Disclosure, Hint, Page, Pager, QueryState } from '../shared/ui';
import type { AttendanceDaysResponse } from '@smartsite/api-client';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { AttendanceReport } from './attendance-report';
import { useTranslation } from '../../i18n';
import {
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconMapPin,
  IconFilter,
} from '../../components/common/Icons';
import { DateRangeFilter } from '../shared/date-range-filter';
import { colors } from '../../theme/colors';
import { MonthYearPicker } from '../shared/month-year-picker';
import { TimeRequestModal } from './time-request-modal';
import { WorkerTimeRequests } from './worker-time-requests';
import { WorkerTodayCard } from './worker-today-card';
import { WorkerAttendanceDay, WorkerAttendanceSummary } from './worker-attendance-board';
import { AttendanceDetail } from './attendance-day-detail';
import { RequestSheet } from '../shared/request-sheet';

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
  const [showFilters, setShowFilters] = useState(false);
  const [showMonths, setShowMonths] = useState(false);
  const [activeView, setActiveView] = useState('BOARD');
  const [requestKind, setRequestKind] = useState<'LEAVE' | 'OVERTIME'>('LEAVE');
  const [submitted, setSubmitted] = useState(false);
  const pageSize = scope.role === 'worker' ? 8 : 20;
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
        items: rows.slice(offset, offset + pageSize),
        total: rows.length,
        todayDayId: rows.find((day) => day.workDate === today)?.id,
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

  const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(uiLocale(), { ...options, timeZone: 'UTC' }).format(
      new Date(`${date}T00:00:00Z`),
    );
  const changeRange = (next: { fromDate: string; toDate: string }) => {
    setRange(next);
    setOffset(0);
  };
  const selectMonth = (year: number, month: number) => {
    changeRange({
      fromDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
      toDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
    });
  };
  const moveMonth = (direction: number) =>
    selectMonth(
      Number(range.fromDate.slice(0, 4)),
      Number(range.fromDate.slice(5, 7)) - 1 + direction,
    );

  return (
    <ScrollView
      style={attStyles.screen}
      contentContainerStyle={[
        attStyles.content,
        scope.role === 'worker' && attStyles.workerContent,
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={attStyles.headingRow}>
        {onBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            style={attStyles.iconButton}
          >
            <IconChevronLeft size={20} color={colors.textPrimary} />
          </Pressable>
        )}
        <View style={attStyles.headingCopy}>
          <Text accessibilityRole="header" style={attStyles.pageTitle}>
            {scope.role === 'worker' ? t('attendance.myTitle') : t('attendance.teamTitle')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('attendance.today')}
          onPress={() => changeRange({ fromDate: today, toDate: today })}
          style={({ pressed }) => [attStyles.iconButton, pressed && attStyles.pressed]}
        >
          <IconCalendar size={21} color={colors.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('requests.filter')}
          accessibilityState={{ expanded: showFilters }}
          onPress={() => setShowFilters(!showFilters)}
          style={({ pressed }) => [
            attStyles.iconButton,
            showFilters && attStyles.iconButtonActive,
            pressed && attStyles.pressed,
          ]}
        >
          <IconFilter size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      {scope.role === 'worker' && (
        <CompactTabs
          value={activeView}
          options={[
            { value: 'BOARD', label: t('attendanceUi.board') },
            { value: 'REQUESTS', label: t('attendanceUi.myRequests') },
          ]}
          onChange={(view) => {
            setActiveView(view);
            setSubmitted(false);
          }}
        />
      )}
      {submitted && (
        <Text accessibilityLiveRegion="polite" style={attStyles.successNotice}>
          {t('attendanceUi.sent')}
        </Text>
      )}
      {scope.role === 'worker' && activeView === 'REQUESTS' ? (
        <WorkerTimeRequests
          onCreate={(kind) => {
            setRequestKind(kind);
            setSubmitted(false);
            setRequestOpen(true);
          }}
        />
      ) : (
        <>
          {scope.role === 'worker' && (
            <>
              <WorkerTodayCard dayId={days.data?.todayDayId} onDay={setDayId} />
              {days.data?.canRequest && (
                <View style={attStyles.quickActions}>
                  {(['LEAVE', 'OVERTIME'] as const).map((kind) => (
                    <Pressable
                      key={kind}
                      accessibilityRole="button"
                      accessibilityLabel={t(
                        kind === 'LEAVE'
                          ? 'attendanceUi.leaveAction'
                          : 'attendanceUi.overtimeAction',
                      )}
                      style={({ pressed }) => [attStyles.quickAction, pressed && attStyles.pressed]}
                      onPress={() => {
                        setRequestKind(kind);
                        setSubmitted(false);
                        setRequestOpen(true);
                      }}
                    >
                      {kind === 'LEAVE' ? (
                        <IconCalendar size={18} color={colors.primary} />
                      ) : (
                        <IconClock size={18} color={colors.primary} />
                      )}
                      <Text style={attStyles.quickTitle}>
                        {t(
                          kind === 'LEAVE'
                            ? 'attendanceUi.leaveAction'
                            : 'attendanceUi.overtimeAction',
                        )}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
          <View style={attStyles.periodRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('attendance.period')}
              accessibilityHint={t('schedule.chooseMonth')}
              accessibilityState={{ expanded: showMonths }}
              onPress={() => {
                setShowFilters(false);
                setShowMonths(true);
              }}
              style={({ pressed }) => [attStyles.periodPill, pressed && attStyles.pressed]}
            >
              <IconCalendar size={17} color={colors.textSecondary} />
              <Text style={attStyles.periodText}>
                {range.fromDate.slice(0, 7) === range.toDate.slice(0, 7)
                  ? dateLabel(range.fromDate, { month: 'long', year: 'numeric' })
                  : t('attendance.customRange')}
              </Text>
              <IconChevronDown size={16} color={colors.textSecondary} />
            </Pressable>
            <View style={attStyles.periodNavigation}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('attendance.previousMonth')}
                onPress={() => moveMonth(-1)}
                style={attStyles.periodArrow}
              >
                <IconChevronLeft size={20} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('attendance.nextMonth')}
                onPress={() => moveMonth(1)}
                style={attStyles.periodArrow}
              >
                <IconChevronRight size={20} color={colors.textPrimary} />
              </Pressable>
            </View>
          </View>
          <Text style={attStyles.rangeCaption}>
            {dateLabel(range.fromDate, { day: '2-digit', month: '2-digit', year: 'numeric' })} –{' '}
            {dateLabel(range.toDate, { day: '2-digit', month: '2-digit', year: 'numeric' })}
          </Text>

          {showFilters && (
            <RequestSheet
              visible
              variant="compact"
              title={t('attendance.period')}
              onClose={() => setShowFilters(false)}
              footer={
                <Button secondary label={t('common.done')} onPress={() => setShowFilters(false)} />
              }
            >
              <DateRangeFilter
                range={range}
                onChange={(next) => {
                  changeRange(next);
                  setShowFilters(false);
                }}
                onValidate={(newRange) => validDates(newRange.fromDate, newRange.toDate)}
              />
            </RequestSheet>
          )}

          {/* Confirmed total with separate overtime and provisional hours. */}
          <QueryState query={summary}>
            {(s) =>
              scope.role === 'worker' ? (
                <WorkerAttendanceSummary summary={s} siteName={scope.siteName} />
              ) : (
                <View style={attStyles.summaryCard}>
                  <View style={attStyles.summaryHeading}>
                    <View style={attStyles.summaryIcon}>
                      <IconClock size={22} color={colors.primary} />
                    </View>
                    <View style={attStyles.headingCopy}>
                      <Text style={attStyles.summaryCardTitle}>{t('attendance.overview')}</Text>
                      <Text style={attStyles.summarySubtitle}>{scope.siteName}</Text>
                    </View>
                  </View>
                  <Text style={attStyles.confirmedLabel}>{t('attendance.confirmedHours')}</Text>
                  <Text style={attStyles.confirmedTotal}>{minutes(s.totalMinutes)}</Text>
                  <View style={attStyles.summaryGrid}>
                    <View style={[attStyles.summaryCol, { backgroundColor: colors.primaryLight }]}>
                      <Text style={attStyles.summaryValueOrange}>{minutes(s.overtimeMinutes)}</Text>
                      <Text style={attStyles.summaryLabel}>{t('attendance.overtime')}</Text>
                    </View>
                    <View style={[attStyles.summaryCol, { backgroundColor: '#EFF6FF' }]}>
                      <Text style={attStyles.summaryValueBlue}>
                        {minutes(s.provisionalMinutes)}
                      </Text>
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
              )
            }
          </QueryState>

          {/* Days List & Requests */}
          <QueryState query={days}>
            {(data) => (
              <>
                <View style={attStyles.listHeading}>
                  <Text style={attStyles.listTitle}>{t('attendance.attendanceHistory')}</Text>
                  <View style={attStyles.countBadge}>
                    <Text style={attStyles.countText}>
                      {t('attendance.recordCount', { count: data.total })}
                    </Text>
                  </View>
                </View>
                {!data.items.length && (
                  <View style={attStyles.emptyState}>
                    <View style={attStyles.emptyIcon}>
                      <IconClock size={32} color={colors.primary} />
                    </View>
                    <Text style={attStyles.emptyTitle}>{t('attendance.noDaysInRange')}</Text>
                    <Text style={attStyles.emptySubtitle}>{t('attendance.emptyHistoryHint')}</Text>
                  </View>
                )}
                {(scope.role !== 'worker' || data.total > pageSize || offset > 0) && (
                  <Pager offset={offset} total={data.total} size={pageSize} onChange={setOffset} />
                )}
                <View
                  style={
                    scope.role === 'worker' ? attStyles.workerHistory : attStyles.contractorHistory
                  }
                >
                  {data.items.map((day, index) =>
                    scope.role === 'worker' ? (
                      <WorkerAttendanceDay
                        key={day.id}
                        day={day}
                        onPress={() => setDayId(day.id)}
                      />
                    ) : (
                      <View key={day.id} style={attStyles.dayTimelineRow}>
                        <View style={attStyles.dayRail}>
                          <Text style={attStyles.railDay}>{day.workDate.slice(8)}</Text>
                          <Text style={attStyles.railMonth}>
                            {dateLabel(day.workDate, { month: 'short' })}
                          </Text>
                          <View style={attStyles.railDot} />
                          {index < data.items.length - 1 && <View style={attStyles.railLine} />}
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`${day.workDate} ${scope.role === 'contractor' ? day.workerName : (day.shiftName ?? t('attendance.shiftNotAssigned'))}`}
                          style={({ pressed }) => [
                            attStyles.dayCard,
                            {
                              borderLeftColor:
                                day.status === 'CONFIRMED'
                                  ? colors.success
                                  : day.status === 'NEEDS_REVIEW'
                                    ? colors.warning
                                    : colors.primary,
                            },
                            pressed && attStyles.pressed,
                          ]}
                          onPress={() => setDayId(day.id)}
                        >
                          <View style={attStyles.dayCardHeader}>
                            <View style={attStyles.dayInfoCol}>
                              <View
                                style={[
                                  attStyles.dayStatusPill,
                                  {
                                    backgroundColor:
                                      day.status === 'CONFIRMED'
                                        ? colors.successBg
                                        : day.status === 'NEEDS_REVIEW'
                                          ? colors.warningBg
                                          : colors.primaryLight,
                                  },
                                ]}
                              >
                                <Text style={attStyles.dayStatusText}>
                                  {localizedLabel(day.status)}
                                </Text>
                              </View>
                              <Text style={attStyles.dayWorkerName}>
                                {scope.role === 'contractor'
                                  ? day.workerName
                                  : (day.shiftName ?? t('attendance.shiftNotAssigned'))}
                              </Text>
                              <View style={attStyles.presenceBadge}>
                                <View
                                  style={[
                                    attStyles.miniDot,
                                    {
                                      backgroundColor:
                                        day.presence === 'INSIDE' ? '#10B981' : '#F66B17',
                                    },
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

                          <View style={attStyles.cardLocation}>
                            <IconMapPin size={15} color={colors.textMuted} />
                            <Text style={attStyles.locationText}>{scope.siteName}</Text>
                          </View>
                          {day.startsAt && day.endsAt && (
                            <Text style={attStyles.locationText}>
                              {t('attendanceUi.scheduleHours')}{' '}
                              {new Date(day.startsAt).toLocaleTimeString(uiLocale(), {
                                timeZone: day.timezone,
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                              {' – '}
                              {new Date(day.endsAt).toLocaleTimeString(uiLocale(), {
                                timeZone: day.timezone,
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </Text>
                          )}

                          {day.anomalies.length > 0 && (
                            <View style={attStyles.anomaliesRow}>
                              {day.anomalies
                                .filter(
                                  (a) =>
                                    a !== 'PENDING_REQUEST' ||
                                    !day.anomalies.includes('PENDING_LEAVE'),
                                )
                                .map((a, i) => (
                                  <View key={i} style={attStyles.anomalyPill}>
                                    <Text style={attStyles.anomalyText}>
                                      ⚠️{' '}
                                      {a === 'PENDING_LEAVE'
                                        ? t(
                                            day.presence === 'OUTSIDE' &&
                                              day.provisionalMinutes === 0 &&
                                              day.endsAt &&
                                              Date.parse(day.endsAt) <= Date.now()
                                              ? 'leavePolicy.absentPendingLeave'
                                              : 'leavePolicy.pendingLeave',
                                          )
                                        : localizedLabel(a)}
                                    </Text>
                                  </View>
                                ))}
                            </View>
                          )}

                          <View style={attStyles.dayCardFooter}>
                            <Text style={attStyles.dayDetailLink}>{t('attendance.dayDetail')}</Text>
                            <IconChevronRight size={16} color="#FFFFFF" />
                          </View>
                        </Pressable>
                      </View>
                    ),
                  )}
                </View>

                {scope.role !== 'worker' && (
                  <View style={attStyles.secondaryCard}>
                    <Text style={attStyles.listTitle}>{t('attendance.requestsInRange')}</Text>
                    {!data.requests.length && <Hint>{t('attendance.noRequests')}</Hint>}
                    {data.requests.map((r) => (
                      <Body key={r.id}>
                        {r.kind === 'LEAVE' ? t('attendance.leave') : t('attendance.overtime')} ·{' '}
                        {displayTime(r.startsAt)}–{displayTime(r.endsAt)} ·{' '}
                        {localizedLabel(r.status)}
                        {r.reviewNote ? ` · ${r.reviewNote}` : ''}
                      </Body>
                    ))}
                  </View>
                )}
              </>
            )}
          </QueryState>

          {/* Report & Timesheets */}
          <Disclosure
            title={t('attendanceUi.moreReports')}
            collapsible={scope.role === 'worker'}
            initiallyOpen={scope.role !== 'worker'}
          >
            <AttendanceReport
              key={`${range.fromDate}:${range.toDate}`}
              fromDate={range.fromDate}
              toDate={range.toDate}
              onDay={setDayId}
            />

            <QueryState query={timesheets}>
              {(data) => (
                <View style={attStyles.secondaryCard}>
                  <Text style={attStyles.listTitle}>{t('attendance.confirmedTimesheet')}</Text>
                  {!data.items.length && <Hint>{t('attendance.noConfirmedHours')}</Hint>}
                  {data.items.map((w) => (
                    <Body key={w.workerId}>
                      {w.workerName} · {w.confirmedDays} {tr('attendance.daysSeparator')}{' '}
                      {minutes(w.totalMinutes)}
                    </Body>
                  ))}
                </View>
              )}
            </QueryState>
          </Disclosure>
        </>
      )}

      {/* Slide-up Modal: Gửi yêu cầu nghỉ / tăng ca */}
      <TimeRequestModal
        visible={requestOpen}
        initialKind={requestKind}
        onClose={() => setRequestOpen(false)}
        onSubmitted={() => {
          setSubmitted(true);
          setActiveView('REQUESTS');
        }}
      />
      <MonthYearPicker
        visible={showMonths}
        value={range.fromDate}
        onChange={selectMonth}
        onClose={() => setShowMonths(false)}
      />
    </ScrollView>
  );
}

const attStyles = StyleSheet.create({
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickAction: {
    flex: 1,
    minWidth: 130,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  quickTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  successNotice: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.successBg,
    color: colors.successText,
    fontSize: 14,
    lineHeight: 21,
  },
  secondaryCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 32, gap: 18 },
  workerContent: { paddingTop: 12, gap: 12 },
  contractorHistory: { gap: 18 },
  workerHistory: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconButtonActive: { backgroundColor: colors.primaryLight, borderColor: colors.primaryBorder },
  pressed: { opacity: 0.65 },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  periodPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    minHeight: 44,
    flexShrink: 1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  periodText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    flexShrink: 1,
    textTransform: 'capitalize',
  },
  periodNavigation: { flexDirection: 'row', gap: 2 },
  periodArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  rangeCaption: { fontSize: 12, color: colors.textMuted, marginTop: -10, paddingHorizontal: 4 },
  summaryHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summarySubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  confirmedLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  confirmedTotal: {
    color: colors.textPrimary,
    fontSize: 34,
    lineHeight: 43,
    fontWeight: '800',
    letterSpacing: -1,
    marginTop: -7,
    marginBottom: 6,
  },
  listHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  listTitle: { flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: '800' },
  countBadge: {
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  countText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: colors.surface,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 25,
    color: colors.textPrimary,
  },
  emptySubtitle: { fontSize: 13, lineHeight: 21, textAlign: 'center', color: colors.textMuted },
  dayTimelineRow: { flexDirection: 'row', gap: 10 },
  dayRail: { width: 43, alignItems: 'center' },
  railDay: { fontSize: 20, fontWeight: '800', color: colors.textPrimary, marginTop: 16 },
  railMonth: { fontSize: 10, fontWeight: '600', color: colors.textMuted, marginTop: 2 },
  railDot: {
    width: 11,
    height: 11,
    borderWidth: 3,
    borderColor: colors.primary,
    borderRadius: 6,
    backgroundColor: colors.surface,
    marginTop: 10,
  },
  railLine: { width: 1, flex: 1, backgroundColor: colors.border, marginTop: 6, marginBottom: -18 },
  dayStatusPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  dayStatusText: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
  cardLocation: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  locationText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.borderLight,
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
    gap: 10,
  },
  summaryCol: {
    flex: 1,
    alignItems: 'center',
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 14,
    borderRadius: 14,
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
    flex: 1,
    minWidth: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderLeftWidth: 4,
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
  dayInfoCol: {
    flex: 1,
    gap: 5,
    minWidth: 90,
    flexBasis: 100,
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
    fontSize: 11,
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
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.primary,
    minHeight: 44,
    alignSelf: 'flex-end',
  },
  dayDetailLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
