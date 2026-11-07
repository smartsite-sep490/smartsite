import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { IconCalendar, IconChevronDown, IconClock } from '../../components/common/Icons';
import { ScheduleAssignModal } from '../../components/modals/ScheduleAssignModal';
import { useTranslation, uiLocale } from '../../i18n';
import { colors } from '../../theme/colors';
import { allPages, localDate, validDates } from '../shared/data';
import { DateRangeFilter } from '../shared/date-range-filter';
import { MonthYearPicker } from '../shared/month-year-picker';
import { Button, Card, Choice, Disclosure, Hint, Page, Pager, QueryState } from '../shared/ui';
import { shiftClock } from '../scheduling/schedule-calendar';
import { useWorkspace } from '../workspace/workspace-context';
import { useScopedWorkers } from '../workspace/use-scoped-workers';

const PAGE_SIZE = 8;

export function ContractorSchedule({ initialDate }: { initialDate?: string }) {
  const { t } = useTranslation();
  const { scope, client, token, queryKey } = useWorkspace();
  const [range, setRange] = useState(() => ({
    fromDate: initialDate ?? `${localDate().slice(0, 8)}01`,
    toDate: initialDate ?? localDate(),
  }));
  const [workerId, setWorkerId] = useState('');
  const [offset, setOffset] = useState(0);
  const [months, setMonths] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const workers = useScopedWorkers();
  const shifts = useQuery({
    queryKey: [...queryKey, 'shifts'],
    queryFn: ({ signal }) =>
      allPages((page) => client.listShifts(token, scope.siteId, page), signal),
  });
  const schedules = useQuery({
    queryKey: [...queryKey, 'contractor-schedules', range, workerId, offset],
    enabled: workers.isSuccess,
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
  const changeRange = (value: { fromDate: string; toDate: string }) => {
    setRange(value);
    setOffset(0);
  };
  const date = (value: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(uiLocale(), { ...options, timeZone: 'UTC' }).format(
      new Date(`${value}T00:00:00Z`),
    );
  return (
    <Page title={t('schedule.title')}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('schedule.chooseMonth')}
          onPress={() => setMonths(true)}
          style={styles.month}
        >
          <IconCalendar size={17} color={colors.primary} />
          <Text style={styles.monthText}>
            {date(range.fromDate, { month: 'long', year: 'numeric' })}
          </Text>
          <IconChevronDown size={16} />
        </Pressable>
        <View style={styles.assign}>
          <Button label={t('contractorHome.assignSchedule')} onPress={() => setAssigning(true)} />
        </View>
      </View>
      <Hint>
        {date(range.fromDate, { day: '2-digit', month: '2-digit' })} –{' '}
        {date(range.toDate, { day: '2-digit', month: '2-digit' })}
      </Hint>
      <Disclosure title={t('requests.filter')}>
        <DateRangeFilter
          range={range}
          onChange={changeRange}
          onValidate={(value) => validDates(value.fromDate, value.toDate)}
        />
        <QueryState query={workers}>
          {(data) => (
            <Choice
              label={t('schedule.worker')}
              value={workerId}
              onChange={(id) => {
                setWorkerId(id);
                setOffset(0);
              }}
              options={[
                { value: '', label: t('common.all') },
                ...data.map((worker) => ({
                  value: worker.id,
                  label: `${worker.displayName} · ${worker.externalId}`,
                })),
              ]}
            />
          )}
        </QueryState>
      </Disclosure>
      <QueryState query={workers}>
        {(people) => (
          <QueryState query={shifts}>
            {(templates) => (
              <QueryState query={schedules}>
                {(data) => (
                  <>
                    {!data.items.length && (
                      <Card>
                        <Hint>{t('schedule.noSchedules')}</Hint>
                      </Card>
                    )}
                    {data.items
                      .filter((schedule) =>
                        people.some((person) => person.id === schedule.workerId),
                      )
                      .map((schedule) => {
                        const worker = people.find((person) => person.id === schedule.workerId);
                        const shift = templates.find(
                          (template) => template.id === schedule.shiftId,
                        );
                        return (
                          <Card key={schedule.id}>
                            <View style={styles.cardHeading}>
                              <Text style={styles.worker}>{worker?.displayName}</Text>
                              <Text style={[styles.status, !schedule.isActive && styles.inactive]}>
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
                            <View style={styles.time}>
                              <IconClock size={14} color={colors.textMuted} />
                              <Text style={styles.timeText}>
                                {date(schedule.workDate, {
                                  day: '2-digit',
                                  month: '2-digit',
                                  year: 'numeric',
                                })}
                                {shift
                                  ? ` · ${shiftClock(shift, 'start')} – ${shiftClock(shift, 'end')}`
                                  : ''}
                              </Text>
                            </View>
                          </Card>
                        );
                      })}
                    <Pager
                      offset={offset}
                      total={data.total}
                      size={PAGE_SIZE}
                      onChange={setOffset}
                    />
                  </>
                )}
              </QueryState>
            )}
          </QueryState>
        )}
      </QueryState>
      <MonthYearPicker
        visible={months}
        value={range.fromDate}
        onClose={() => setMonths(false)}
        onChange={(year, month) =>
          changeRange({
            fromDate: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
            toDate: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
          })
        }
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
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  month: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  monthText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  assign: { minWidth: 90 },
  cardHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  worker: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  status: {
    backgroundColor: colors.successBg,
    color: colors.successText,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 99,
  },
  inactive: { backgroundColor: '#F1F5F9', color: colors.textMuted },
  shift: { fontSize: 13, color: colors.textSecondary },
  time: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeText: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 19 },
});
