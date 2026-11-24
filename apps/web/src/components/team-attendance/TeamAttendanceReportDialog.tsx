import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useManagementClient } from '../../features/auth/auth-session';
import { translate as tr } from '../../i18n';
import { userErrorMessage } from '../../i18n/messages';
import { Button, Dialog, SmartDatePicker } from '../ui';
import { attendanceDate } from '../access/attendance/attendance-display';
import { loadAllPages } from '../workforce/load-all-pages';
import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import { teamText } from './team-attendance-copy';

export function TeamAttendanceReportDialog({
  apiUrl,
  token,
  sessionScope,
  siteId,
  contractorId,
  teamId,
  teamName,
  onClose,
}: {
  apiUrl: string;
  token: string;
  sessionScope: string;
  siteId: string;
  contractorId: string;
  teamId: string;
  teamName: string;
  onClose: () => void;
}) {
  useTranslation();
  const client = useManagementClient(apiUrl),
    shiftInput = useId();
  const [workDate, setDate] = useState(() => attendanceDate(new Date(), 'Asia/Ho_Chi_Minh'));
  const [shiftChoice, setShift] = useState('');
  const options = useQuery({
    queryKey: ['contractor-zone-attendance-options', apiUrl, sessionScope, siteId, contractorId],
    queryFn: async ({ signal }) => {
      const [shifts, versions] = await Promise.all([
        loadAllPages((page) => client.listShifts(token, siteId, page), signal),
        loadAllPages((page) => client.listScheduleVersions(token, siteId, page), signal),
      ]);
      return { shifts: shifts.items, versions: versions.items };
    },
    retry: false,
  });
  const shiftId =
    shiftChoice || (options.data?.shifts.length === 1 ? options.data.shifts[0]!.id : '');
  const enabled = options.isSuccess && !!workDate && !!shiftId && !!options.data.versions.length;
  const report = useQuery({
    queryKey: [
      'contractor-zone-attendance',
      apiUrl,
      sessionScope,
      siteId,
      contractorId,
      teamId,
      workDate,
      shiftId,
      options.data?.versions.map((version) => version.id),
    ],
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        options.data!.versions.map((version) =>
          loadAllPages(
            (page) =>
              client.contractorTeamAttendance(token, siteId, contractorId, teamId, {
                workDate,
                shiftId,
                scheduleVersionId: version.id,
                ...page,
              }),
            signal,
          ),
        ),
      );
      const items = [
        ...new Map(
          pages.flatMap((page) => page.items).map((member) => [member.scheduleId, member]),
        ).values(),
      ];
      return {
        items,
        present: items.filter((m) => m.status === 'PRESENT').length,
        absent: items.filter((m) => m.status === 'ABSENT').length,
        pending: items.filter((m) => m.status === 'NOT_YET').length,
      };
    },
    enabled,
    retry: false,
    refetchInterval: 15000,
  });
  return (
    <Dialog
      open
      title={`${teamText('teamWeb.viewAttendance')} · ${teamName}`}
      maxWidth="xl"
      onClose={onClose}
    >
      {options.isPending ? (
        <p role="status">{tr('common.loading')}</p>
      ) : options.isError ? (
        <div role="alert">
          <p>{userErrorMessage(options.error)}</p>
          <Button onClick={() => void options.refetch()}>{tr('common.retry')}</Button>
        </div>
      ) : (
        <>
          <div className="mb-5 grid items-end gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
            <SmartDatePicker
              label={teamText('teamWeb.workDate')}
              value={workDate}
              disablePast={false}
              onChange={(date) => {
                setDate(date);
              }}
            />

            <label htmlFor={shiftInput} className="space-y-2 text-sm font-semibold">
              {teamText('teamWeb.shift')}
              <SmartNativeSelect
                id={shiftInput}
                value={shiftId}
                className="block w-full"
                onChange={(event) => {
                  setShift(event.target.value);
                }}
              >
                <option value="">{teamText('teamWeb.choose')}</option>
                {options.data.shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name}
                  </option>
                ))}
              </SmartNativeSelect>
            </label>
          </div>
          {!options.data.shifts.length || !options.data.versions.length ? (
            <p>{teamText('teamWeb.noSchedules')}</p>
          ) : !enabled ? (
            <p>{teamText('teamWeb.chooseFilters')}</p>
          ) : report.isPending ? (
            <p role="status">{tr('common.loading')}</p>
          ) : report.isError ? (
            <div role="alert">
              <p>{userErrorMessage(report.error)}</p>
              <Button onClick={() => void report.refetch()}>{tr('common.retry')}</Button>
            </div>
          ) : (
            report.data && (
              <>
                <div
                  className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-slate-200 px-4 py-3"
                  role="status"
                >
                  {(['PRESENT', 'ABSENT', 'NOT_YET'] as const).map((status) => (
                    <div key={status} className="flex items-baseline gap-2">
                      <span
                        className={
                          'text-2xl font-bold tabular-nums ' +
                          (status === 'PRESENT'
                            ? 'text-emerald-700'
                            : status === 'ABSENT'
                              ? 'text-rose-700'
                              : 'text-slate-700')
                        }
                      >
                        {status === 'PRESENT'
                          ? report.data.present
                          : status === 'ABSENT'
                            ? report.data.absent
                            : report.data.pending}
                      </span>
                      <span className="text-xs font-medium text-slate-600">
                        {teamText(`teamWeb.status.${status}`)}
                      </span>
                    </div>
                  ))}
                </div>
                {!report.data.items.length ? (
                  <p>{teamText('teamWeb.emptyRoster')}</p>
                ) : (
                  <div className="max-h-96 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <caption className="sr-only">
                        {teamName} · {workDate}
                      </caption>
                      <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
                        <tr>
                          {[
                            teamText('teamWeb.worker'),
                            teamText('teamWeb.result'),
                            teamText('teamWeb.gateResult'),
                          ].map((label) => (
                            <th
                              key={label}
                              scope="col"
                              className="border-b border-slate-200 px-4 py-3"
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.data.items.map((member) => (
                          <tr key={member.scheduleId}>
                            <td className="border-b border-slate-100 px-4 py-4 font-semibold text-slate-900">
                              {member.displayName}
                            </td>
                            <td className="border-b p-2">
                              <span
                                className={
                                  'inline-flex whitespace-nowrap items-center rounded-lg px-3 py-1.5 text-xs font-bold ring-1 ring-inset ' +
                                  (member.status === 'PRESENT'
                                    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                                    : member.status === 'ABSENT'
                                      ? 'bg-rose-50 text-rose-800 ring-rose-200'
                                      : 'bg-slate-100 text-slate-700 ring-slate-200')
                                }
                              >
                                {teamText(`teamWeb.status.${member.status}`)}
                              </span>
                            </td>
                            <td className="border-b p-2">
                              {teamText(`teamWeb.gate.${member.gateCheck}`)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )
          )}
        </>
      )}
    </Dialog>
  );
}
