import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ShiftResponse, WorkerScheduleResponse } from '@smartsite/api-client';
import {
  IconCalendar,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconMapPin,
} from '../../components/common/Icons';
import { WorkerAvatar } from '../../components/common/WorkerAvatar';
import { useTranslation, uiLocale } from '../../i18n';
import { colors } from '../../theme/colors';
import { allPages, localDate, validDates } from '../shared/data';
import { Body, Button, Card, Choice, Hint, Page, QueryState } from '../shared/ui';
import { useWorkspace } from '../workspace/workspace-context';
import { MonthYearPicker } from '../shared/month-year-picker';
import {
  addCalendarDays,
  calendarDate,
  calendarWeek,
  changeCalendarMonth,
  shiftClock,
  shiftDayOffset,
} from './schedule-calendar';

type ScheduleStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';
type Selection = { schedule: WorkerScheduleResponse; shift?: ShiftResponse };

function initialDay(value?: string) {
  if (value) {
    try {
      validDates(value, value);
      return value;
    } catch {
      // An obsolete notification date must not prevent opening the calendar.
    }
  }
  return localDate();
}

function FilterIcon() {
  return (
    <View style={styles.filterIcon}>
      {[4, 12, 7].map((left, index) => (
        <View key={index} style={styles.filterTrack}>
          <View style={[styles.filterKnob, { left }]} />
        </View>
      ))}
    </View>
  );
}

export function WorkerScheduleScreen({
  initialDate,
  onRequest,
}: {
  initialDate?: string;
  onRequest: (schedule: WorkerScheduleResponse, shift?: ShiftResponse) => void;
}) {
  const { t } = useTranslation();
  const { scope, user, client, token, queryKey, workerId } = useWorkspace();
  const [selectedDate, setSelectedDate] = useState(() => initialDay(initialDate));
  const [selected, setSelected] = useState<Selection | null>(null);
  const [showMonths, setShowMonths] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState<ScheduleStatus>('ACTIVE');
  const [shiftId, setShiftId] = useState('');
  const week = calendarWeek(selectedDate);
  const fromDate = week[0]!;
  const toDate = week[6]!;
  const today = localDate();
  const locale = uiLocale();
  const formatDate = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(calendarDate(value));
  const dateLabel = (value: string) =>
    formatDate(value, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  const schedules = useQuery({
    queryKey: [...queryKey, 'weekly-schedules', workerId, fromDate, toDate],
    enabled: !!workerId,
    queryFn: ({ signal }) =>
      allPages(
        (page) =>
          client.listWorkerSchedules(token, scope.siteId, {
            ...page,
            fromDate,
            toDate,
            workerId,
            status: 'ALL',
          }),
        signal,
      ),
  });
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) =>
      allPages((page) => client.listShifts(token, scope.siteId, page), signal),
  });
  const team = useQuery({
    queryKey: [...queryKey, 'my-team'],
    queryFn: () => client.myContractorTeam(token, scope.siteId),
  });
  const shiftById = new Map(shifts.data?.map((shift) => [shift.id, shift]));
  const visibleSchedules = (schedules.data ?? []).filter(
    (schedule) =>
      schedule.workerId === workerId &&
      (status === 'ALL' || schedule.isActive === (status === 'ACTIVE')) &&
      (!shiftId || schedule.shiftId === shiftId),
  );
  const scheduledDates = new Set(visibleSchedules.filter((s) => s.isActive).map((s) => s.workDate));
  const dailySchedules = visibleSchedules
    .filter((schedule) => schedule.workDate === selectedDate)
    .sort((a, b) => {
      const first = shiftById.get(a.shiftId);
      const second = shiftById.get(b.shiftId);
      return (first ? shiftClock(first, 'start') : '99:99').localeCompare(
        second ? shiftClock(second, 'start') : '99:99',
      );
    });
  const hasFilters = status !== 'ACTIVE' || !!shiftId;
  const shiftTime = (shift?: ShiftResponse) => {
    if (!shift) return t('schedule.timeUnavailable');
    const nextDay = shiftDayOffset(shift);
    const duration = (+new Date(shift.endsAt) - +new Date(shift.startsAt)) / 3600000;
    return `${shiftClock(shift, 'start')} – ${shiftClock(shift, 'end')}${nextDay > 0 ? ` ${t('schedule.nextDay', { count: nextDay })}` : ''} · ${t('schedule.hours', { hours: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(duration) })}`;
  };

  if (selected)
    return (
      <Page title={t('schedule.details')} onBack={() => setSelected(null)}>
        <Card>
          <Text style={styles.shiftTitle}>{selected.shift?.name ?? t('schedule.shift')}</Text>
          <Body>{dateLabel(selected.schedule.workDate)}</Body>
          <Body>{scope.siteName}</Body>
          <Body>{shiftTime(selected.shift)}</Body>
          {selected.shift && <Hint>{selected.shift.timezone}</Hint>}
          <Hint>
            {t(
              selected.schedule.isActive ? 'schedule.activeSchedule' : 'schedule.cancelledSchedule',
            )}
          </Hint>
          {selected.schedule.isActive && (
            <Button
              label={t('schedule.requestAction')}
              onPress={() => onRequest(selected.schedule, selected.shift)}
            />
          )}
        </Card>
      </Page>
    );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>{t('schedule.myCalendar')}</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {t('schedule.title')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('attendance.today')}
          onPress={() => setSelectedDate(localDate())}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <IconCalendar size={21} color={colors.primary} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('requests.filter')}
          accessibilityState={{ expanded: showFilters }}
          onPress={() => setShowFilters(!showFilters)}
          style={({ pressed }) => [
            styles.iconButton,
            showFilters && styles.iconButtonActive,
            pressed && styles.pressed,
          ]}
        >
          <FilterIcon />
          {hasFilters && <View style={styles.filterDot} />}
        </Pressable>
      </View>

      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.chooseMonth')}
          onPress={() => setShowMonths(true)}
          style={({ pressed }) => [styles.monthPill, pressed && styles.pressed]}
        >
          <IconCalendar size={17} color={colors.textSecondary} />
          <Text style={styles.monthText}>
            {formatDate(selectedDate, { month: 'long', year: 'numeric' })}
          </Text>
          <IconChevronDown size={16} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.weekNavigation}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('schedule.previousWeek')}
            onPress={() => setSelectedDate(addCalendarDays(selectedDate, -7))}
            style={styles.weekArrow}
          >
            <IconChevronLeft size={20} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('schedule.nextWeek')}
            onPress={() => setSelectedDate(addCalendarDays(selectedDate, 7))}
            style={styles.weekArrow}
          >
            <IconChevronRight size={20} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      {showFilters && (
        <View style={styles.filterPanel}>
          <Text style={styles.sectionTitle}>{t('requests.filter')}</Text>
          <View style={styles.statusFilters}>
            {(['ACTIVE', 'INACTIVE', 'ALL'] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: status === value }}
                accessibilityLabel={t(`schedule.filter${value}`)}
                onPress={() => setStatus(value)}
                style={[styles.filterChip, status === value && styles.filterChipActive]}
              >
                <Text style={[styles.filterLabel, status === value && styles.filterLabelActive]}>
                  {t(`schedule.filter${value}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Choice
            label={t('schedule.shift')}
            value={shiftId}
            onChange={setShiftId}
            options={[
              { value: '', label: t('schedule.allShifts') },
              ...(shifts.data ?? []).map((shift) => ({ value: shift.id, label: shift.name })),
            ]}
          />
          {hasFilters && (
            <Button
              secondary
              label={t('schedule.clearFilters')}
              onPress={() => {
                setStatus('ACTIVE');
                setShiftId('');
              }}
            />
          )}
        </View>
      )}

      <FlatList
        horizontal
        data={week}
        extraData={`${selectedDate}:${[...scheduledDates].join(',')}`}
        keyExtractor={(day) => day}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.weekStrip}
        style={styles.weekList}
        renderItem={({ item: day }) => {
          const active = day === selectedDate;
          const hasShift = scheduledDates.has(day);
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={`${dateLabel(day)}${hasShift ? `, ${t('schedule.hasShift')}` : ''}`}
              accessibilityState={{ selected: active }}
              onPress={() => setSelectedDate(day)}
              style={({ pressed }) => [
                styles.dayPill,
                day === today && styles.todayPill,
                active && styles.selectedPill,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.weekday, active && styles.selectedText]}>
                {t(`schedule.weekday${calendarDate(day).getUTCDay()}`)}
              </Text>
              <Text style={[styles.dayNumber, active && styles.selectedText]}>{day.slice(8)}</Text>
              <View
                style={[styles.dayDot, active && styles.selectedDot, !hasShift && styles.hiddenDot]}
              />
            </Pressable>
          );
        }}
      />

      <View style={styles.agendaHeader}>
        <View style={styles.headingCopy}>
          <Text style={styles.sectionTitle}>
            {selectedDate === today
              ? t('attendance.today')
              : formatDate(selectedDate, { weekday: 'long' })}
          </Text>
          <Text style={styles.agendaDate}>
            {formatDate(selectedDate, { day: '2-digit', month: 'long', year: 'numeric' })}
          </Text>
        </View>
        {schedules.isSuccess && shifts.isSuccess && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>
              {t('schedule.shiftCount', { count: dailySchedules.length })}
            </Text>
          </View>
        )}
      </View>

      <QueryState query={shifts}>
        {() => (
          <QueryState query={schedules}>
            {() => (
              <>
                {!dailySchedules.length && (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIcon}>
                      <IconCalendar size={32} color={colors.primary} />
                    </View>
                    <Text style={styles.emptyTitle}>
                      {hasFilters
                        ? t('schedule.noFilterMatches')
                        : selectedDate === today
                          ? t('schedule.noTodayShifts')
                          : t('schedule.noDayShifts')}
                    </Text>
                    <Text style={styles.emptySubtitle}>{t('schedule.emptyHint')}</Text>
                    {hasFilters && (
                      <Button
                        secondary
                        label={t('schedule.clearFilters')}
                        onPress={() => {
                          setStatus('ACTIVE');
                          setShiftId('');
                        }}
                      />
                    )}
                  </View>
                )}
                {dailySchedules.map((schedule, index) => {
                  const shift = shiftById.get(schedule.shiftId);
                  const hour = shift ? Number(shiftClock(shift, 'start').slice(0, 2)) : 0;
                  const period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'night';
                  const accent = !schedule.isActive
                    ? colors.textMuted
                    : period === 'morning'
                      ? colors.primary
                      : period === 'afternoon'
                        ? '#2563EB'
                        : '#7C3AED';
                  const pastel = !schedule.isActive
                    ? '#F1F5F9'
                    : period === 'morning'
                      ? '#FFF4EE'
                      : period === 'afternoon'
                        ? '#EFF6FF'
                        : '#F5F3FF';
                  return (
                    <View key={schedule.id} style={styles.timelineRow}>
                      <View style={styles.timeRail}>
                        <Text style={styles.railTime}>
                          {shift ? shiftClock(shift, 'start') : '—'}
                        </Text>
                        <View style={[styles.timelineDot, { borderColor: accent }]} />
                        {index < dailySchedules.length - 1 && <View style={styles.timelineLine} />}
                      </View>
                      <View style={[styles.shiftCard, { borderLeftColor: accent }]}>
                        <View style={styles.cardTop}>
                          <View style={[styles.periodBadge, { backgroundColor: pastel }]}>
                            <Text style={[styles.periodText, { color: accent }]}>
                              {!schedule.isActive
                                ? t('schedule.cancelledSchedule')
                                : shift
                                  ? t(`schedule.${period}`)
                                  : t('schedule.shift')}
                            </Text>
                          </View>
                          <Text style={styles.cardIndex}>{String(index + 1).padStart(2, '0')}</Text>
                        </View>
                        <Text style={styles.shiftTitle}>
                          {shift?.name ?? t('schedule.shiftUnavailable')}
                        </Text>
                        <Text style={styles.projectName}>{scope.siteName}</Text>
                        <View style={styles.metadataRow}>
                          <IconClock size={15} color={colors.textMuted} />
                          <Text style={styles.metadataText}>{shiftTime(shift)}</Text>
                        </View>
                        <View style={styles.metadataRow}>
                          <IconMapPin size={15} color={colors.textMuted} />
                          <Text style={styles.metadataText}>{scope.siteName}</Text>
                        </View>
                        <View style={styles.cardFooter}>
                          <View style={styles.assignment}>
                            <WorkerAvatar size={30} />
                            <View style={styles.assignmentCopy}>
                              <Text numberOfLines={1} style={styles.assignmentName}>
                                {user.displayName}
                              </Text>
                              <Text numberOfLines={1} style={styles.assignmentTeam}>
                                {team.isError
                                  ? t('schedule.teamUnavailable')
                                  : (team.data?.teamName ?? t('schedule.myAssignment'))}
                              </Text>
                            </View>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={t('schedule.details')}
                            onPress={() => setSelected({ schedule, shift })}
                            style={({ pressed }) => [
                              styles.detailButton,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text style={styles.detailButtonText}>{t('schedule.details')}</Text>
                            <IconChevronRight size={14} color="#FFFFFF" />
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </QueryState>
        )}
      </QueryState>

      <MonthYearPicker
        visible={showMonths}
        value={selectedDate}
        onChange={(year, month) => setSelectedDate(changeCalendarMonth(selectedDate, year, month))}
        onClose={() => setShowMonths(false)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 32, gap: 18 },
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
  title: {
    color: colors.textPrimary,
    fontSize: 26,
    lineHeight: 34,
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
  filterIcon: { width: 20, gap: 5 },
  filterTrack: { height: 2, backgroundColor: colors.textSecondary },
  filterKnob: {
    position: 'absolute',
    top: -2,
    width: 5,
    height: 6,
    borderRadius: 2,
    backgroundColor: colors.surface,
    borderColor: colors.textSecondary,
    borderWidth: 1.5,
  },
  filterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  monthPill: {
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
  monthText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    flexShrink: 1,
    textTransform: 'capitalize',
  },
  weekNavigation: { flexDirection: 'row', gap: 2 },
  weekArrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  weekList: { flexGrow: 0 },
  weekStrip: { gap: 7, paddingVertical: 4 },
  dayPill: {
    minWidth: 44,
    paddingHorizontal: 7,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  todayPill: { borderColor: colors.primaryBorder },
  selectedPill: { backgroundColor: colors.primary, borderColor: colors.primary },
  weekday: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  dayNumber: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  selectedText: { color: '#FFFFFF' },
  dayDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary },
  selectedDot: { backgroundColor: '#FFFFFF' },
  hiddenDot: { opacity: 0 },
  filterPanel: {
    padding: 16,
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
  },
  filterChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primaryBorder },
  filterLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  filterLabelActive: { color: colors.primary },
  agendaHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  agendaDate: { fontSize: 12, color: colors.textMuted, marginTop: 5 },
  countBadge: {
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  countText: { fontSize: 11, fontWeight: '700', color: colors.primary },
  timelineRow: { flexDirection: 'row', gap: 10 },
  timeRail: { width: 43, alignItems: 'center' },
  railTime: { fontSize: 12, fontWeight: '800', color: colors.textSecondary, marginTop: 18 },
  timelineDot: {
    width: 11,
    height: 11,
    borderWidth: 3,
    borderRadius: 6,
    marginTop: 10,
    backgroundColor: colors.surface,
  },
  timelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: colors.border,
    marginTop: 6,
    marginBottom: -18,
  },
  shiftCard: {
    flex: 1,
    minWidth: 0,
    padding: 15,
    gap: 10,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.045,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  periodBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, flexShrink: 1 },
  periodText: { fontSize: 10, fontWeight: '700' },
  cardIndex: { color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
  shiftTitle: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, lineHeight: 25 },
  projectName: { color: colors.textMuted, fontSize: 12, marginTop: -5, marginBottom: 3 },
  metadataRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  metadataText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 18 },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    paddingTop: 12,
    marginTop: 3,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  assignment: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 80 },
  assignmentCopy: { flex: 1, minWidth: 0 },
  assignmentName: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  assignmentTeam: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
  detailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 10,
    backgroundColor: colors.primary,
  },
  detailButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 36,
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
});
