import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ContractorTeamCalendarItem } from '@smartsite/api-client';
import {
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconFilter,
  IconUsers,
} from '../../components/common/Icons';
import { ScheduleAssignModal } from '../../components/modals/ScheduleAssignModal';
import { useTranslation, uiLocale } from '../../i18n';
import { colors } from '../../theme/colors';
import { allPages, localDate, validDates } from '../shared/data';
import { Choice, Page, QueryState } from '../shared/ui';
import { ManagementBadge, ManagementLink, ManagementTabs } from '../shared/management-ui';
import { MonthYearPicker } from '../shared/month-year-picker';
import { RequestSheet } from '../shared/request-sheet';
import {
  addCalendarDays,
  calendarDate,
  calendarWeek,
  changeCalendarMonth,
  shiftClock,
  shiftRange,
} from '../scheduling/schedule-calendar';
import { useWorkspace } from '../workspace/workspace-context';
import { EmptyState } from './contractor-presentation';
import { ContractorAttendancePanel } from './contractor-attendance-panel';
import { ScheduleDaySummary } from '../scheduling/schedule-day-summary';
import { ContractorTeamAttendancePanel } from './team-attendance-panel';
import { AttendanceDetail } from '../attendance/attendance-day-detail';
import { ScheduleBatchSheet } from './schedule-batch-sheet';

function startDay(value?: string) {
  if (value) {
    try {
      validDates(value, value);
      return value;
    } catch {
      /* Obsolete notification dates fall back to today. */
    }
  }
  return localDate();
}
export function ContractorSchedule({ initialDate }: { initialDate?: string }) {
  const { t } = useTranslation();
  const { client, token, scope, queryKey } = useWorkspace();
  const [tab, setTab] = useState('ASSIGNMENT');
  const [day, setDay] = useState(() => startDay(initialDate));
  const [months, setMonths] = useState(false);
  const [filters, setFilters] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [selected, setSelected] = useState<ContractorTeamCalendarItem | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [attendanceDayId, setAttendanceDayId] = useState('');
  const [managingBatches, setManagingBatches] = useState(false);
  const week = calendarWeek(day),
    fromDate = week[0]!,
    toDate = week[6]!;
  const calendar = useQuery({
    queryKey: [...queryKey, 'contractor-team-calendar', fromDate, toDate, teamId],
    enabled: tab === 'ASSIGNMENT',
    refetchInterval: 15000,
    queryFn: () =>
      client.contractorTeamCalendar(token, scope.siteId, {
        contractorId: scope.contractorId,
        fromDate,
        toDate,
        ...(teamId ? { teamId } : {}),
      }),
  });
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    enabled: tab === 'ASSIGNMENT',
    queryFn: ({ signal }) =>
      allPages((page) => client.listShifts(token, scope.siteId, page), signal),
  });
  const teams = useQuery({
    queryKey: [...queryKey, 'calendar-teams'],
    enabled: filters,
    queryFn: ({ signal }) =>
      allPages(
        (page) =>
          client.listContractorTeams(token, scope.siteId, scope.contractorId, {
            ...page,
            status: 'ALL',
          }),
        signal,
      ),
  });
  const format = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(uiLocale(), { ...options, timeZone: 'UTC' }).format(
      calendarDate(value),
    );
  const dates = new Set(calendar.data?.items.map((item) => item.workDate));
  const templates = new Map(shifts.data?.map((shift) => [shift.id, shift]));
  const rows = (calendar.data?.items ?? [])
    .filter((item) => item.workDate === day)
    .sort((a, b) => {
      const first = templates.get(a.shiftId),
        second = templates.get(b.shiftId);
      return (
        (first ? shiftClock(first, 'start') : '').localeCompare(
          second ? shiftClock(second, 'start') : '',
        ) || a.teamName.localeCompare(b.teamName)
      );
    });
  const selectedShift = selected ? templates.get(selected.shiftId) : undefined;
  if (attendanceDayId)
    return <AttendanceDetail dayId={attendanceDayId} onBack={() => setAttendanceDayId('')} />;
  return (
    <Page>
      <View style={styles.header}>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{t('teamCalendar.eyebrow')}</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {t('teamCalendar.title')}
          </Text>
          <Text style={styles.hint}>{scope.siteName}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('attendance.today')}
          style={styles.today}
          onPress={() => setDay(localDate())}
        >
          <Text style={styles.todayText}>{t('attendance.today')}</Text>
        </Pressable>
      </View>
      <ManagementTabs
        value={tab}
        onChange={setTab}
        items={[
          {
            value: 'ASSIGNMENT',
            label: t('teamCalendar.scheduleTab'),
            accessibilityLabel: t('schedule.tabAssignment'),
          },
          { value: 'ATTENDANCE', label: t('schedule.tabAttendance') },
        ]}
      />
      {tab === 'ATTENDANCE' ? (
        <ContractorAttendancePanel initialDate={initialDate} />
      ) : (
        <>
          <View style={styles.toolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('schedule.chooseMonth')}
              onPress={() => setMonths(true)}
              style={styles.month}
            >
              <IconCalendar size={17} color={colors.textMuted} />
              <Text style={styles.monthText}>
                {format(day, { month: 'long', year: 'numeric' })}
              </Text>
              <IconChevronDown size={15} color={colors.textMuted} />
            </Pressable>
            <View style={styles.arrows}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('schedule.previousWeek')}
                onPress={() => setDay(addCalendarDays(day, -7))}
                style={styles.iconButton}
              >
                <IconChevronLeft size={20} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('schedule.nextWeek')}
                onPress={() => setDay(addCalendarDays(day, 7))}
                style={styles.iconButton}
              >
                <IconChevronRight size={20} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('requests.filter')}
                accessibilityState={{ expanded: filters }}
                onPress={() => setFilters(!filters)}
                style={[styles.iconButton, (filters || !!teamId) && styles.filterActive]}
              >
                <IconFilter size={19} color={colors.textSecondary} />
              </Pressable>
            </View>
          </View>
          {filters && (
            <View style={styles.filters}>
              <QueryState query={teams}>
                {(items) => (
                  <Choice
                    label={t('scheduleAssign.team')}
                    value={teamId}
                    onChange={setTeamId}
                    options={[
                      { value: '', label: t('teamCalendar.allTeams') },
                      ...items.map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                )}
              </QueryState>
            </View>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.week}
          >
            {week.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="tab"
                accessibilityLabel={format(value, {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                })}
                accessibilityState={{ selected: value === day }}
                onPress={() => setDay(value)}
                style={[styles.day, value === day && styles.selectedDay]}
              >
                <Text style={[styles.weekday, value === day && styles.selectedText]}>
                  {t(`schedule.weekday${calendarDate(value).getUTCDay()}`)}
                </Text>
                <Text style={[styles.dayNumber, value === day && styles.selectedText]}>
                  {value.slice(8)}
                </Text>
                <View
                  style={[
                    styles.dot,
                    value === day && styles.selectedDot,
                    !dates.has(value) && styles.hiddenDot,
                  ]}
                />
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.dayHeading}>
            <View style={styles.copy}>
              <Text style={styles.dayTitle}>
                {day === localDate() ? t('attendance.today') : format(day, { weekday: 'long' })}
              </Text>
              <Text style={styles.hint}>
                {format(day, { day: '2-digit', month: 'long', year: 'numeric' })}
              </Text>
            </View>
            <ManagementLink
              label={t('contractorHome.assignSchedule')}
              onPress={() => setAssigning(true)}
            />
            <ManagementLink
              label={t('scheduleManage.open')}
              onPress={() => setManagingBatches(true)}
            />
          </View>
          <QueryState query={shifts}>
            {() => (
              <QueryState query={calendar}>
                {() => (
                  <>
                    {!!calendar.data?.unassignedScheduleCount && (
                      <Text style={styles.hint}>
                        {t('teamCalendar.unassignedHint', {
                          count: calendar.data.unassignedScheduleCount,
                        })}
                      </Text>
                    )}
                    {!rows.length && (
                      <EmptyState
                        icon={<IconCalendar size={29} color={colors.textMuted} />}
                        title={t('teamCalendar.empty')}
                        hint={t('teamCalendar.emptyHint')}
                      />
                    )}
                    {rows.map((item) => {
                      const shift = templates.get(item.shiftId);
                      return (
                        <View
                          key={`${item.teamId}:${item.shiftId}:${item.scheduleVersionId}:${item.workDate}`}
                          style={styles.timeline}
                        >
                          <View style={styles.timeColumn}>
                            <Text style={styles.start}>
                              {shift ? shiftClock(shift, 'start') : '—'}
                            </Text>
                            <View style={styles.line} />
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('teamCalendar.open', { name: item.teamName })}
                            onPress={() => setSelected(item)}
                            style={({ pressed }) => [styles.shiftCard, pressed && { opacity: 0.7 }]}
                          >
                            <View style={styles.cardHeading}>
                              <View style={styles.teamIcon}>
                                <IconUsers size={18} color={colors.primary} />
                              </View>
                              <Text style={styles.teamName}>{item.teamName}</Text>
                              <IconChevronRight size={16} color={colors.textTertiary} />
                            </View>
                            <Text style={styles.shiftName}>
                              {shift?.name ?? t('schedule.shiftUnavailable')}
                            </Text>
                            <View style={styles.cardFooter}>
                              <View style={styles.clockRow}>
                                <IconClock size={14} color={colors.textMuted} />
                                <Text style={styles.hint}>
                                  {shift ? shiftRange(shift) : t('schedule.timeUnavailable')}
                                </Text>
                              </View>
                              <ManagementBadge
                                label={t('teamUi.memberCount', { count: item.workerCount })}
                              />
                            </View>
                          </Pressable>
                        </View>
                      );
                    })}
                  </>
                )}
              </QueryState>
            )}
          </QueryState>
          <MonthYearPicker
            visible={months}
            value={day}
            onClose={() => setMonths(false)}
            onChange={(year, month) => setDay(changeCalendarMonth(day, year, month))}
          />
          {selected && (
            <RequestSheet
              visible
              variant="compact"
              title={t('scheduleDay.title')}
              subtitle={scope.siteName}
              onClose={() => setSelected(null)}
              footer={null}
            >
              <ScheduleDaySummary workDate={selected.workDate} shift={selectedShift} />
              <View style={styles.dayTeamCard}>
                <View style={styles.clockRow}>
                  <IconUsers size={17} color={colors.primary} />
                  <Text style={styles.hint}>{t('scheduleDay.group')}</Text>
                </View>
                <Text style={[styles.teamName, { flex: 0 }]}>{selected.teamName}</Text>
                <ManagementBadge
                  label={t('teamCalendar.assignedCount', { count: selected.workerCount })}
                />
                <Text style={styles.hint}>{t('scheduleDay.groupHint')}</Text>
              </View>
              <ContractorTeamAttendancePanel
                key={`${selected.teamId}:${selected.workDate}:${selected.shiftId}:${selected.scheduleVersionId}`}
                item={selected}
                onDay={(id) => {
                  setSelected(null);
                  setAttendanceDayId(id);
                }}
              />
            </RequestSheet>
          )}
          {assigning && (
            <ScheduleAssignModal
              visible
              teamOnly
              onClose={() => setAssigning(false)}
              onSuccess={() => void calendar.refetch()}
            />
          )}
          {managingBatches && <ScheduleBatchSheet onClose={() => setManagingBatches(false)} />}
        </>
      )}
    </Page>
  );
}
const styles = StyleSheet.create({
  dayTeamCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surfaceSubtle,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  eyebrow: {
    fontSize: 10,
    color: colors.primary,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: { fontSize: 25, lineHeight: 33, fontWeight: '800', color: colors.textPrimary },
  hint: { fontSize: 12, lineHeight: 19, color: colors.textMuted },
  today: {
    minHeight: 44,
    paddingHorizontal: 12,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  todayText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  month: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.surface,
    flexShrink: 1,
  },
  monthText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  arrows: { flexDirection: 'row', gap: 4 },
  iconButton: {
    width: 38,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: colors.surface,
  },
  filterActive: { backgroundColor: colors.primaryLight },
  filters: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 14,
  },
  week: { flexGrow: 1, gap: 7, justifyContent: 'space-between', paddingVertical: 4 },
  day: {
    width: 43,
    minHeight: 80,
    borderRadius: 20,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  selectedDay: { backgroundColor: colors.primary, borderColor: colors.primary },
  weekday: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  dayNumber: { fontSize: 19, fontWeight: '700', color: colors.textPrimary },
  selectedText: { color: '#FFFFFF' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary },
  selectedDot: { backgroundColor: '#FFFFFF' },
  hiddenDot: { opacity: 0 },
  dayHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayTitle: { color: colors.textPrimary, fontSize: 16, lineHeight: 24, fontWeight: '700' },
  timeline: { flexDirection: 'row', gap: 10 },
  timeColumn: { width: 43, alignItems: 'center', gap: 10 },
  start: { fontSize: 11, fontWeight: '600', color: colors.textMuted, paddingTop: 6 },
  line: { width: 1, backgroundColor: colors.border, flex: 1, minHeight: 65 },
  shiftCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 18,
    padding: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
    gap: 11,
  },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  teamIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  teamName: { flex: 1, color: colors.textPrimary, fontSize: 14, lineHeight: 22, fontWeight: '700' },
  shiftName: { color: colors.textSecondary, fontSize: 13, lineHeight: 21 },
  cardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'space-between',
  },
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
