import { useTranslation } from '../../i18n';
import { localizedLabel } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useLayoutEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useWorkspace } from '../workspace/workspace-context';
import { displayTime, minutes, useCommand } from '../shared/data';
import { Body, Button, ErrorNotice, Hint, Pager, QueryState } from '../shared/ui';
import { attendanceCsv } from './report-csv';
import { colors } from '../../theme/colors';
import { IconChevronDown, IconChevronUp, IconDocument } from '../../components/common/Icons';
export function AttendanceReport({
  fromDate,
  toDate,
  onDay,
}: {
  fromDate: string;
  toDate: string;
  onDay: (id: string) => void;
}) {
  useTranslation();
  const { scope, client, token, workerId, queryKey, user } = useWorkspace();
  const canExport =
    scope.role === 'contractor' &&
    user.isActive &&
    !user.mustChangePassword &&
    user.roleAssignments.some(
      (role) => role.role === 'CONTRACTOR_REPRESENTATIVE' && role.siteId === scope.siteId,
    );
  const exportController = useRef<AbortController | null>(null);
  useLayoutEffect(
    () => () => exportController.current?.abort(),
    [client, token, user.id, scope.siteId, scope.contractorId, scope.role, canExport],
  );
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0),
    [expanded, setExpanded] = useState('');
  const command = useCommand();
  const filter = {
    fromDate,
    toDate,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(scope.role === 'worker' ? { workerId } : { contractorId: scope.contractorId }),
  };
  const query = useQuery({
    queryKey: [...queryKey, 'attendance-report', filter, offset],
    enabled: open,
    queryFn: () =>
      client.attendanceWorkers(token, scope.siteId, {
        ...filter,
        includeDaily: true,
        offset,
        limit: 20,
      }),
  });
  return (
    <View style={reportStyles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('attendance.workerReport')}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={({ pressed }) => [reportStyles.heading, pressed && { opacity: 0.65 }]}
      >
        <View style={reportStyles.headingIcon}>
          <IconDocument size={20} color={colors.primary} />
        </View>
        <Text style={reportStyles.title}>{tr('attendance.workerReport')}</Text>
        {open ? <IconChevronUp size={20} /> : <IconChevronDown size={20} />}
      </Pressable>
      {open && (
        <View style={reportStyles.content}>
          <ErrorNotice error={command.error} />
          {canExport && (
            <Button
              secondary
              label={tr('attendance.shareCsv')}
              disabled={command.isPending}
              onPress={() =>
                command.mutate(async () => {
                  const controller = new AbortController();
                  exportController.current = controller;
                  if (!(await Sharing.isAvailableAsync()))
                    throw new Error(tr('validation.sharingUnavailable'));
                  const result = await client.attendanceExport(token, scope.siteId, filter, {
                    signal: controller.signal,
                  });
                  controller.signal.throwIfAborted();
                  if (!result.items.length) throw new Error(tr('common.noData'));
                  const file = new File(
                    Paths.cache,
                    `attendance-${fromDate}-${toDate}-${Date.now()}.csv`,
                  );
                  try {
                    file.create();
                    file.write(attendanceCsv(result.items));
                    controller.signal.throwIfAborted();
                    await Sharing.shareAsync(file.uri, {
                      mimeType: 'text/csv',
                      UTI: 'public.comma-separated-values-text',
                    });
                  } finally {
                    if (file.exists) file.delete();
                  }
                })
              }
            />
          )}
          <QueryState query={query}>
            {(data) => (
              <>
                {!data.items.length && <Hint>{tr('common.noData')}</Hint>}
                {data.items.map((w) => (
                  <View key={w.workerId} style={reportStyles.workerCard}>
                    <Text style={reportStyles.workerName}>{w.workerName}</Text>
                    <Text style={reportStyles.workerCode}>{w.workerCode}</Text>
                    <Hint>
                      {tr('attendance.todayLabel')} {localizedLabel(w.todayStatus)} ·{' '}
                      {displayTime(w.todayFirstCheckInAt)} → {displayTime(w.todayLastCheckOutAt)}
                    </Hint>
                    <Body>
                      {tr('attendance.confirmedLabel')} {minutes(w.totalMinutes)}
                    </Body>
                    <Hint>
                      {tr('attendance.provisionalLabel')} {minutes(w.provisionalMinutes)} ·{' '}
                      {w.presentDays}/{w.requiredDays} {tr('attendance.daysSeparator')}{' '}
                      {w.attendanceRate === null ? tr('attendance.noRate') : `${w.attendanceRate}%`}
                    </Hint>
                    <Button
                      secondary
                      label={
                        expanded === w.workerId
                          ? tr('attendance.closeCalendar')
                          : tr('attendance.dailyCalendar')
                      }
                      onPress={() => setExpanded(expanded === w.workerId ? '' : w.workerId)}
                    />
                    {expanded === w.workerId &&
                      w.daily?.map((d) => (
                        <View key={d.workDate} style={reportStyles.dailyCard}>
                          <Body>
                            {d.workDate} · {localizedLabel(d.status)}
                          </Body>
                          <Hint>
                            {d.hoursStatus === 'CONFIRMED'
                              ? tr('attendance.confirmed')
                              : tr('attendance.provisionalHours')}{' '}
                            ·{' '}
                            {minutes(
                              d.hoursStatus === 'CONFIRMED' ? d.totalMinutes : d.provisionalMinutes,
                            )}
                          </Hint>
                          {d.attendanceDayId && (
                            <Button
                              secondary
                              label={tr('attendance.openDay')}
                              onPress={() => onDay(d.attendanceDayId!)}
                            />
                          )}
                        </View>
                      ))}
                  </View>
                ))}
                <Pager offset={offset} total={data.total} onChange={setOffset} />
              </>
            )}
          </QueryState>
        </View>
      )}
    </View>
  );
}

const reportStyles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  content: { gap: 14 },
  headingIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  title: { flex: 1, fontSize: 16, fontWeight: '800', color: colors.textPrimary, lineHeight: 23 },
  workerCard: {
    gap: 10,
    borderRadius: 14,
    padding: 14,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  workerName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  workerCode: { color: colors.textMuted, fontSize: 12, marginTop: -5 },
  dailyCard: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    backgroundColor: colors.surface,
  },
});
