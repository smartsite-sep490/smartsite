import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useManagementClient } from '../../features/auth/auth-session';
import { translate as tr } from '../../i18n';
import { userErrorMessage } from '../../i18n/messages';
import { Button, Dialog, SmartDatePicker } from '../ui';
import { attendanceDate } from '../access/attendance/attendance-display';
import { loadAllPages } from '../workforce/load-all-pages';
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
    shiftInput = useId(),
    versionInput = useId();
  const [workDate, setDate] = useState(() => attendanceDate(new Date(), 'Asia/Ho_Chi_Minh'));
  const [shiftChoice, setShift] = useState(''),
    [versionChoice, setVersion] = useState(''),
    [offset, setOffset] = useState(0);
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
  const scheduleVersionId =
    versionChoice || (options.data?.versions.length === 1 ? options.data.versions[0]!.id : '');
  const enabled = options.isSuccess && !!workDate && !!shiftId && !!scheduleVersionId;
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
      scheduleVersionId,
      offset,
    ],
    queryFn: () =>
      client.contractorTeamAttendance(token, siteId, contractorId, teamId, {
        workDate,
        shiftId,
        scheduleVersionId,
        offset,
        limit: 20,
      }),
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
      <p className="text-sm text-slate-600">{teamText('teamWeb.reportHint')}</p>
      {options.isPending ? (
        <p role="status">{tr('common.loading')}</p>
      ) : options.isError ? (
        <div role="alert">
          <p>{userErrorMessage(options.error)}</p>
          <Button onClick={() => void options.refetch()}>{tr('common.retry')}</Button>
        </div>
      ) : (
        <>
          <SmartDatePicker
            label={teamText('teamWeb.workDate')}
            value={workDate}
            disablePast={false}
            onChange={(date) => {
              setDate(date);
              setOffset(0);
            }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor={shiftInput} className="space-y-2 text-sm font-semibold">
              {teamText('teamWeb.shift')}
              <select
                id={shiftInput}
                value={shiftId}
                className="block w-full rounded-xl border border-slate-300 bg-white p-2.5 focus-visible:outline-2 focus-visible:outline-orange-600"
                onChange={(event) => {
                  setShift(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">{teamText('teamWeb.choose')}</option>
                {options.data.shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={versionInput} className="space-y-2 text-sm font-semibold">
              {teamText('teamWeb.version')}
              <select
                id={versionInput}
                value={scheduleVersionId}
                className="block w-full rounded-xl border border-slate-300 bg-white p-2.5 focus-visible:outline-2 focus-visible:outline-orange-600"
                onChange={(event) => {
                  setVersion(event.target.value);
                  setOffset(0);
                }}
              >
                <option value="">{teamText('teamWeb.choose')}</option>
                {options.data.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {teamText('teamWeb.versionValue', { version: version.version })}
                  </option>
                ))}
              </select>
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
                <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold">
                  {teamText('teamWeb.reportTotals', {
                    present: report.data.present,
                    absent: report.data.absent,
                    pending: report.data.pending,
                  })}
                </p>
                {!report.data.items.length ? (
                  <p>{teamText('teamWeb.emptyRoster')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">
                        {teamName} · {workDate}
                      </caption>
                      <thead>
                        <tr>
                          {[
                            teamText('teamWeb.worker'),
                            teamText('teamWeb.result'),
                            teamText('teamWeb.gateResult'),
                          ].map((label) => (
                            <th key={label} scope="col" className="border-b p-2">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.data.items.map((member) => (
                          <tr key={member.scheduleId}>
                            <td className="border-b p-2 font-semibold">{member.displayName}</td>
                            <td className="border-b p-2">
                              {teamText(`teamWeb.status.${member.status}`)}
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
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset === 0}
                    onClick={() => setOffset((n) => Math.max(0, n - 20))}
                  >
                    {teamText('teamWeb.previous')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={offset + report.data.items.length >= report.data.total}
                    onClick={() => setOffset((n) => n + 20)}
                  >
                    {teamText('teamWeb.next')}
                  </Button>
                </div>
              </>
            )
          )}
        </>
      )}
    </Dialog>
  );
}
