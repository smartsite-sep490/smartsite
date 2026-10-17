import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useWorkspace } from '../workspace/workspace-context';
import { allPages, displayTime, minutes, useCommand } from '../shared/data';
import { Body, Button, Card, ErrorNotice, Hint, Pager, QueryState } from '../shared/ui';
import { attendanceCsv } from './report-csv';
export function AttendanceReport({
  fromDate,
  toDate,
  onDay,
}: {
  fromDate: string;
  toDate: string;
  onDay: (id: string) => void;
}) {
  const { scope, client, token, workerId, queryKey } = useWorkspace();
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
    queryFn: () =>
      client.attendanceWorkers(token, scope.siteId, {
        ...filter,
        includeDaily: true,
        offset,
        limit: 20,
      }),
  });
  return (
    <Card>
      <Body>Báo cáo công theo công nhân</Body>
      <ErrorNotice error={command.error} />
      <Button
        secondary
        label="Xuất / chia sẻ CSV"
        disabled={command.isPending}
        onPress={() =>
          command.mutate(async () => {
            if (!(await Sharing.isAvailableAsync()))
              throw new Error('Thiết bị chưa hỗ trợ chia sẻ tệp.');
            const rows = await allPages((p) =>
              client.attendanceWorkers(token, scope.siteId, { ...filter, ...p }),
            );
            const file = new File(
              Paths.cache,
              `attendance-${fromDate}-${toDate}-${Date.now()}.csv`,
            );
            try {
              file.create();
              file.write(attendanceCsv(rows));
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
      <QueryState query={query}>
        {(data) => (
          <>
            {data.items.map((w) => (
              <Card key={w.workerId}>
                <Body>
                  {w.workerName} · {w.workerCode}
                </Body>
                <Hint>
                  Hôm nay: {w.todayStatus} · {displayTime(w.todayFirstCheckInAt)} →{' '}
                  {displayTime(w.todayLastCheckOutAt)}
                </Hint>
                <Body>Công xác nhận: {minutes(w.totalMinutes)}</Body>
                <Hint>
                  Tạm tính: {minutes(w.provisionalMinutes)} · {w.presentDays}/{w.requiredDays} ngày
                  · {w.attendanceRate === null ? 'Chưa có tỷ lệ' : `${w.attendanceRate}%`}
                </Hint>
                <Button
                  secondary
                  label={expanded === w.workerId ? 'Đóng lịch công' : 'Lịch công từng ngày'}
                  onPress={() => setExpanded(expanded === w.workerId ? '' : w.workerId)}
                />
                {expanded === w.workerId &&
                  w.daily?.map((d) => (
                    <Card key={d.workDate}>
                      <Body>
                        {d.workDate} · {d.status}
                      </Body>
                      <Hint>
                        {d.hoursStatus === 'CONFIRMED' ? 'Đã xác nhận' : 'Tạm tính'} ·{' '}
                        {minutes(
                          d.hoursStatus === 'CONFIRMED' ? d.totalMinutes : d.provisionalMinutes,
                        )}
                      </Hint>
                      {d.attendanceDayId && (
                        <Button
                          secondary
                          label="Mở ngày công"
                          onPress={() => onDay(d.attendanceDayId!)}
                        />
                      )}
                    </Card>
                  ))}
              </Card>
            ))}
            <Pager offset={offset} total={data.total} onChange={setOffset} />
          </>
        )}
      </QueryState>
    </Card>
  );
}
