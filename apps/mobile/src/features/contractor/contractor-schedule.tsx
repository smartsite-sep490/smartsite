import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import {
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFilter,
} from '../../components/common/Icons';
import { ScheduleAssignModal } from '../../components/modals/ScheduleAssignModal';
import { useTranslation, uiLocale } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { colors } from '../../theme/colors';
import { allPages, localDate, minutes, validDates } from '../shared/data';
import { DateRangeFilter } from '../shared/date-range-filter';
import { MonthYearPicker } from '../shared/month-year-picker';
import { Button, Card, Choice, CompactTabs, Page, Pager, QueryState } from '../shared/ui';
import {
  addCalendarDays,
  calendarDate,
  calendarWeek,
  changeCalendarMonth,
  shiftClock,
} from '../scheduling/schedule-calendar';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';
import { EmptyState, ListHeading } from './contractor-presentation';
import { WorkerAttendanceSummary } from '../attendance/worker-attendance-board';
import { AttendanceDetail } from '../attendance/attendance-day-detail';

const PAGE_SIZE = 8;

export function ContractorSchedule({ initialDate }: { initialDate?: string }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [activeTab, setActiveTab] = useState('ASSIGNMENT');
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? localDate());
  const [assignmentRange, setAssignmentRange] = useState(() => ({
    fromDate: initialDate ?? localDate(),
    toDate: initialDate ?? localDate(),
  }));
  const [attendanceRange, setAttendanceRange] = useState(() => ({
    fromDate: initialDate ?? `${localDate().slice(0, 8)}01`,
    toDate: initialDate ?? localDate(),
  }));
  const [workerId, setWorkerId] = useState('');
  const [offset, setOffset] = useState(0);
  const [months, setMonths] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [dayId, setDayId] = useState('');
  const range = activeTab === 'ASSIGNMENT' ? assignmentRange : attendanceRange;
  const workers = useScopedWorkers();
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) =>
      allPages((page) => client.listShifts(token, scope.siteId, page), signal),
  });
  const schedules = useQuery({
    queryKey: [...queryKey, 'contractor-schedules', range, workerId, offset],
    enabled: workers.isSuccess && activeTab === 'ASSIGNMENT',
    queryFn: () =>
      client.listWorkerSchedules(token, scope.siteId, {
        ...range,
        contractorId: scope.contractorId,
        ...(workerId ? { workerId } : {}),
        offset,
        limit: PAGE_SIZE,
        status: 'ALL',
      }),
  });
  const summary = useQuery({
    queryKey: [...queryKey, 'contractor-attendance-summary', range, workerId],
    enabled: workers.isSuccess && activeTab === 'ATTENDANCE',
    queryFn: () =>
      client.attendanceSummary(token, scope.siteId, {
        ...range,
        ...(workerId ? { workerId } : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        contractorId: scope.contractorId,
      }),
  });
  const attendanceDays = useQuery({
    queryKey: [...queryKey, 'contractor-attendance-days', range, workerId, offset],
    enabled: workers.isSuccess && activeTab === 'ATTENDANCE',
    queryFn: async ({ signal }) => {
      const ids = new Set(workers.data?.map((worker) => worker.id));
      const rows = (
        await allPages(
          (page) =>
            client.attendanceDays(token, scope.siteId, {
              ...range,
              ...page,
              ...(workerId ? { workerId } : {}),
            }),
          signal,
        )
      ).filter((day) => ids.has(day.workerId));
      return { items: rows.slice(offset, offset + PAGE_SIZE), total: rows.length };
    },
  });
  const changeRange = (value: { fromDate: string; toDate: string }) => {
    if (activeTab === 'ASSIGNMENT') {
      setAssignmentRange(value);
      setSelectedDate(value.fromDate);
    } else setAttendanceRange(value);
    setOffset(0);
  };
  const date = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(uiLocale(), { ...options, timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00Z`),
    );
  const move = (direction: number) => {
    if (activeTab === 'ASSIGNMENT') {
      const next = addCalendarDays(selectedDate, direction * 7);
      changeRange({ fromDate: next, toDate: next });
    } else {
      const first =
        changeCalendarMonth(
          range.fromDate,
          Number(range.fromDate.slice(0, 4)),
          Number(range.fromDate.slice(5, 7)) - 1 + direction,
        ).slice(0, 8) + '01';
      const last = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10);
      changeRange({ fromDate: first, toDate: last });
    }
  };
  if (dayId) return <AttendanceDetail dayId={dayId} onBack={() => setDayId('')} />;
  return (
    <Page title={t('schedule.contractorTitle')}>
      <Text style={styles.subtitle}>
        {scope.contractorName} · {scope.siteName}
      </Text>
      <CompactTabs
        value={activeTab}
        options={[
          { value: 'ASSIGNMENT', label: t('schedule.tabAssignment') },
          { value: 'ATTENDANCE', label: t('schedule.tabAttendance') },
        ]}
        onChange={(value) => {
          setActiveTab(value);
          setOffset(0);
        }}
      />
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.chooseMonth')}
          accessibilityState={{ expanded: months }}
          onPress={() => setMonths(true)}
          style={styles.month}
        >
          <IconCalendar size={17} color={colors.textSecondary} />
          <Text style={styles.monthText}>
            {date(activeTab === 'ASSIGNMENT' ? selectedDate : range.fromDate, {
              month: 'long',
              year: 'numeric',
            })}
          </Text>
          <IconChevronDown size={16} color={colors.textSecondary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            activeTab === 'ASSIGNMENT' ? 'schedule.previousWeek' : 'attendance.previousMonth',
          )}
          onPress={() => move(-1)}
          style={styles.iconButton}
        >
          <IconChevronLeft size={20} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            activeTab === 'ASSIGNMENT' ? 'schedule.nextWeek' : 'attendance.nextMonth',
          )}
          onPress={() => move(1)}
          style={styles.iconButton}
        >
          <IconChevronRight size={20} color={colors.textPrimary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('requests.filter')}
          accessibilityState={{ expanded: showFilters }}
          onPress={() => setShowFilters(!showFilters)}
          style={[styles.iconButton, styles.filterButton, showFilters && styles.activeFilter]}
        >
          <IconFilter size={19} color={colors.textSecondary} />
        </Pressable>
      </View>
      {activeTab === 'ASSIGNMENT' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.week}
          style={styles.weekScroll}
        >
          {calendarWeek(selectedDate).map((day) => (
            <Pressable
              key={day}
              accessibilityRole="tab"
              accessibilityLabel={date(day, { weekday: 'long', day: '2-digit', month: '2-digit' })}
              accessibilityState={{ selected: day === selectedDate }}
              onPress={() => changeRange({ fromDate: day, toDate: day })}
              style={[styles.weekDay, day === selectedDate && styles.selectedDay]}
            >
              <Text style={[styles.weekday, day === selectedDate && styles.selectedText]}>
                {t(`schedule.weekday${calendarDate(day).getUTCDay()}`)}
              </Text>
              <Text style={[styles.dayNumber, day === selectedDate && styles.selectedText]}>
                {day.slice(8)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Text style={styles.caption}>
        {date(range.fromDate, { day: '2-digit', month: '2-digit', year: 'numeric' })}
        {range.fromDate !== range.toDate
          ? ` – ${date(range.toDate, { day: '2-digit', month: '2-digit', year: 'numeric' })}`
          : ''}
      </Text>
      {showFilters && (
        <Card>
          <DateRangeFilter
            range={range}
            onChange={changeRange}
            onValidate={(value) => validDates(value.fromDate, value.toDate)}
          />
          <QueryState query={workers}>
            {(people) => (
              <Choice
                label={t('schedule.worker')}
                value={workerId}
                onChange={(id) => {
                  setWorkerId(id);
                  setOffset(0);
                }}
                options={[
                  { value: '', label: t('common.all') },
                  ...people.map((worker) => ({
                    value: worker.id,
                    label: `${worker.displayName} · ${worker.externalId}`,
                  })),
                ]}
              />
            )}
          </QueryState>
        </Card>
      )}
      {activeTab === 'ASSIGNMENT' ? (
        <>
          <Button label={t('contractorHome.assignSchedule')} onPress={() => setAssigning(true)} />
          <QueryState query={workers}>
            {(people) => (
              <QueryState query={shifts}>
                {(templates) => (
                  <QueryState query={schedules}>
                    {(data) => (
                      <>
                        <ListHeading
                          title={t('schedule.rosterForDate')}
                          count={t('contractorUi.assignmentCount', { count: data.total })}
                        />
                        {!data.items.length && (
                          <EmptyState
                            icon={<IconCalendar size={27} color={colors.primary} />}
                            title={t('schedule.noSchedulesForDate')}
                            hint={t('contractorUi.assignEmptyHint')}
                          />
                        )}
                        {data.items
                          .filter((schedule) =>
                            people.some((person) => person.id === schedule.workerId),
                          )
                          .map((schedule) => {
                            const worker = people.find(
                              (person) => person.id === schedule.workerId,
                            )!;
                            const shift = templates.find(
                              (template) => template.id === schedule.shiftId,
                            );
                            return (
                              <Card key={schedule.id}>
                                <View style={styles.cardHeading}>
                                  <View style={styles.copy}>
                                    <Text style={styles.name}>{worker.displayName}</Text>
                                    <Text style={styles.caption}>{worker.externalId}</Text>
                                  </View>
                                  <Text style={styles.status}>
                                    {t(
                                      schedule.isActive
                                        ? 'schedule.filterACTIVE'
                                        : 'schedule.filterINACTIVE',
                                    )}
                                  </Text>
                                </View>
                                <Text style={styles.shift}>
                                  {shift?.name ?? t('schedule.shiftUnavailable')}
                                </Text>
                                <View style={styles.cardFooter}>
                                  <Text style={styles.caption}>
                                    {date(schedule.workDate, {
                                      weekday: 'short',
                                      day: '2-digit',
                                      month: '2-digit',
                                    })}
                                  </Text>
                                  <Text style={styles.clock}>
                                    {shift
                                      ? `${shiftClock(shift, 'start')} – ${shiftClock(shift, 'end')}`
                                      : '—'}
                                  </Text>
                                </View>
                              </Card>
                            );
                          })}
                        {data.total > PAGE_SIZE && (
                          <Pager
                            offset={offset}
                            total={data.total}
                            size={PAGE_SIZE}
                            onChange={setOffset}
                          />
                        )}
                      </>
                    )}
                  </QueryState>
                )}
              </QueryState>
            )}
          </QueryState>
        </>
      ) : (
        <>
          <QueryState query={summary}>
            {(value) => <WorkerAttendanceSummary summary={value} siteName={scope.siteName} />}
          </QueryState>
          <QueryState query={attendanceDays}>
            {(data) => (
              <>
                <ListHeading
                  title={t('attendance.attendanceHistory')}
                  count={t('attendance.recordCount', { count: data.total })}
                />
                {!data.items.length && (
                  <EmptyState
                    icon={<IconClock size={27} color={colors.primary} />}
                    title={t('attendance.noDaysInRange')}
                    hint={t('attendance.emptyHistoryHint')}
                  />
                )}
                {data.items.map((day) => (
                  <Pressable
                    key={day.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${day.workDate} ${day.workerName}`}
                    accessibilityHint={t('attendance.dayDetail')}
                    onPress={() => setDayId(day.id)}
                    style={({ pressed }) => [styles.dayCard, pressed && { opacity: 0.65 }]}
                  >
                    <View style={styles.cardHeading}>
                      <View style={styles.copy}>
                        <Text style={styles.name}>{day.workerName}</Text>
                        <Text style={styles.caption}>
                          {date(day.workDate, {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                          })}
                        </Text>
                      </View>
                      <IconChevronRight size={18} color={colors.textMuted} />
                    </View>
                    <Text style={styles.shift}>
                      {day.shiftName ?? t('attendance.shiftNotAssigned')}
                    </Text>
                    <View style={styles.cardFooter}>
                      <View style={styles.copy}>
                        <Text style={styles.caption}>
                          {t(
                            day.confirmedMinutes === null
                              ? 'attendance.provisionalHours'
                              : 'attendance.confirmedHours',
                          )}
                        </Text>
                        <Text style={styles.hours}>
                          {minutes(day.confirmedMinutes ?? day.provisionalMinutes)}
                        </Text>
                      </View>
                      <Text style={[styles.status, day.status === 'NEEDS_REVIEW' && styles.review]}>
                        {localizedLabel(day.status)}
                      </Text>
                    </View>
                  </Pressable>
                ))}
                {data.total > PAGE_SIZE && (
                  <Pager offset={offset} total={data.total} size={PAGE_SIZE} onChange={setOffset} />
                )}
              </>
            )}
          </QueryState>
        </>
      )}
      <MonthYearPicker
        visible={months}
        value={activeTab === 'ASSIGNMENT' ? selectedDate : range.fromDate}
        onClose={() => setMonths(false)}
        onChange={(year, month) => {
          const first = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
          const last = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
          changeRange({ fromDate: first, toDate: activeTab === 'ASSIGNMENT' ? first : last });
        }}
      />
      {assigning && (
        <ScheduleAssignModal
          visible
          onClose={() => setAssigning(false)}
          onSuccess={() => void schedules.refetch()}
        />
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: 12, lineHeight: 20, color: colors.textMuted, marginTop: -8 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  month: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 14,
  },
  monthText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 19,
    fontWeight: '600',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filterButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  activeFilter: { backgroundColor: colors.primaryLight, borderColor: colors.primaryBorder },
  week: {
    flexDirection: 'row',
    gap: 4,
    padding: 6,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  weekScroll: { flexGrow: 0 },
  weekDay: {
    minWidth: 44,
    paddingHorizontal: 7,
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
    borderRadius: 12,
  },
  selectedDay: { backgroundColor: colors.primary },
  weekday: { fontSize: 10, lineHeight: 15, color: colors.textMuted },
  dayNumber: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: colors.textPrimary },
  selectedText: { color: colors.textWhite },
  caption: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  cardHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'space-between',
  },
  copy: { flex: 1, minWidth: 100, gap: 4 },
  name: { fontSize: 15, lineHeight: 23, fontWeight: '700', color: colors.textPrimary },
  status: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSubtle,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    overflow: 'hidden',
    maxWidth: '100%',
  },
  shift: { fontSize: 13, lineHeight: 21, color: colors.textSecondary },
  cardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 12,
  },
  clock: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: colors.textPrimary },
  dayCard: {
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  hours: { fontSize: 20, lineHeight: 28, fontWeight: '700', color: colors.textPrimary },
  review: { color: colors.warningText, backgroundColor: colors.warningLightBg },
});
