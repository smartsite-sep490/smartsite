import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ShiftResponse,
  SubmitTeamAttendanceCommand,
  TeamAttendanceMemberResponse,
  WorkerScheduleResponse,
} from '@smartsite/api-client';
import { useManagementClient } from '../../features/auth/auth-session';
import { translate as tr } from '../../i18n';
import { userErrorMessage } from '../../i18n/messages';
import { Button, Dialog } from '../ui';
import { formatWorkDate, formatShiftRange } from '../workforce/utils/workforce-format';
import { teamText } from './team-attendance-copy';

type Entry = SubmitTeamAttendanceCommand['entries'][number];

export function TeamAttendanceDialog({
  apiUrl,
  token,
  sessionScope,
  siteId,
  schedule,
  shift,
  onClose,
}: {
  apiUrl: string;
  token: string;
  sessionScope: string;
  siteId: string;
  schedule: WorkerScheduleResponse;
  shift?: ShiftResponse;
  onClose: () => void;
}) {
  useTranslation();
  const client = useManagementClient(apiUrl),
    cache = useQueryClient(),
    reasonId = useId(),
    searchId = useId();
  const key = ['team-zone-attendance', apiUrl, sessionScope, siteId, schedule.id];
  const attendance = useQuery({
    queryKey: key,
    queryFn: () => client.scheduleTeamAttendance(token, siteId, schedule.id),
    refetchInterval: 15000,
    retry: false,
  });
  const [drafts, setDrafts] = useState<Record<string, Entry>>({});
  const [context, setContext] = useState<{ teamId: string; zoneId: string } | null>(null);
  const [reason, setReason] = useState(''),
    [search, setSearch] = useState('');
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const data = attendance.data;
  const entries = Object.values(drafts);
  const correcting = entries.some((entry) => entry.expectedVersion > 0);
  const changed =
    !!context &&
    (context.teamId !== data?.teamId ||
      context.zoneId !== data?.zoneId ||
      entries.some((entry) => {
        const member = data?.members.find((m) => m.scheduleId === entry.scheduleId);
        return (
          !member ||
          member.locked ||
          member.membershipId !== entry.expectedMembershipId ||
          member.version !== entry.expectedVersion
        );
      }));
  const save = useMutation({
    mutationFn: (input: SubmitTeamAttendanceCommand) =>
      client.submitTeamAttendance(token, siteId, schedule.id, input),
    onSuccess: async () => {
      setDrafts({});
      setReason('');
      setContext(null);
      request.current = null;
      await Promise.all([
        cache.invalidateQueries({ queryKey: key }),
        ...[
          'attendance',
          'attendance-summary',
          'attendance-workers',
          'attendance-worker-report',
          'attendance-days',
          'attendance-day-detail',
          'attendance-timesheets',
        ].map((name) =>
          cache.invalidateQueries({ queryKey: [name, apiUrl, sessionScope, siteId] }),
        ),
        cache.invalidateQueries({
          queryKey: ['schedule-attendance', apiUrl, sessionScope, siteId],
        }),
      ]);
    },
  });
  const ready =
    !!data?.canManage &&
    !!data.canSubmit &&
    !!data.teamId &&
    !!data.zoneId &&
    !attendance.isError &&
    !attendance.isFetching;
  const valid =
    ready &&
    entries.length > 0 &&
    entries.length <= 500 &&
    !changed &&
    (!correcting || reason.trim().length >= 5);
  function select(member: TeamAttendanceMemberResponse, status: Entry['status']) {
    if (
      !ready ||
      member.locked ||
      !member.membershipId ||
      !data?.teamId ||
      !data.zoneId ||
      save.isPending ||
      changed
    )
      return;
    save.reset();
    setContext((previous) => previous ?? { teamId: data.teamId!, zoneId: data.zoneId! });
    setDrafts((previous) => {
      const next = { ...previous };
      if (status === member.status) {
        delete next[member.scheduleId];
        return next;
      }
      next[member.scheduleId] = {
        scheduleId: member.scheduleId,
        expectedMembershipId:
          previous[member.scheduleId]?.expectedMembershipId ?? member.membershipId!,
        expectedVersion: previous[member.scheduleId]?.expectedVersion ?? member.version,
        status,
      };
      return next;
    });
  }
  function submit() {
    if (!valid || !context || save.isPending) return;
    const input = { ...context, entries, ...(correcting ? { reason: reason.trim() } : {}) };
    const fingerprint = JSON.stringify(input);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    save.mutate({ ...input, requestId: request.current.id });
  }
  const visible =
    data?.members.filter((m) =>
      m.displayName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    ) ?? [];
  return (
    <Dialog
      open
      title={teamText('teamWeb.attendance')}
      maxWidth="xl"
      onClose={() => {
        if (!save.isPending) onClose();
      }}
    >
      <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm">
        <p className="text-base font-bold text-slate-900">
          {formatWorkDate(schedule.workDate)} · {shift?.name ?? tr('common.shift')}
        </p>
        {shift && (
          <p className="mt-1 text-slate-600">
            {formatShiftRange(shift.startsAt, shift.endsAt, shift.timezone)}
          </p>
        )}
      </div>
      {attendance.isPending ? (
        <p role="status">{tr('common.loading')}</p>
      ) : attendance.isError ? (
        <p role="alert" className="text-sm text-rose-700">
          {userErrorMessage(attendance.error)}
        </p>
      ) : (
        data && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-300 bg-slate-50 p-4 text-sm">
              <div>
                <p className="text-xs text-slate-500">{teamText('teamWeb.assignment')}</p>
                <p className="text-base font-bold text-slate-900">
                  {data.teamName ?? '—'} / {data.zoneName ?? '—'}
                </p>
              </div>
              <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold">
                {teamText(`teamWeb.status.${data.own.status}`)}
              </span>
              <p className="w-full text-xs text-slate-600">
                {teamText(`teamWeb.gate.${data.own.gateCheck}`)}
              </p>
            </div>
            {data.canManage && !data.zoneId && (
              <p role="status" className="text-sm text-amber-800">
                {teamText('teamWeb.noZone')}
              </p>
            )}
            {data.canManage && data.zoneId && !data.canSubmit && (
              <div
                role="status"
                className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-relaxed text-amber-900"
              >
                {teamText(
                  schedule.isActive && data.members.some((member) => !member.locked)
                    ? 'teamWeb.beforeStart'
                    : data.members.length > 0 && data.members.every((member) => member.locked)
                      ? 'teamWeb.recordsLocked'
                      : 'teamWeb.attendanceUnavailable',
                )}
              </div>
            )}
            {data.canManage && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <h4 className="font-semibold text-slate-900">{teamText('teamWeb.roster')}</h4>
                <p className="text-xs text-slate-600">{teamText('teamWeb.selectHint')}</p>
                <label htmlFor={searchId} className="block text-xs font-semibold">
                  {teamText('teamWeb.search')}
                </label>
                <input
                  id={searchId}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-sm focus-visible:outline-2 focus-visible:outline-orange-600"
                />
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {!data.members.length ? (
                    <p>{teamText('teamWeb.emptyRoster')}</p>
                  ) : !visible.length ? (
                    <p>{teamText('teamWeb.noMatches')}</p>
                  ) : (
                    visible.map((member) => (
                      <fieldset
                        key={member.scheduleId}
                        disabled={
                          !ready ||
                          member.locked ||
                          !member.membershipId ||
                          changed ||
                          save.isPending
                        }
                        className="min-w-0 rounded-xl border border-slate-200 p-3 disabled:opacity-60"
                      >
                        <legend className="max-w-full break-words px-1 text-sm font-semibold">
                          {member.displayName}
                        </legend>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-slate-600">
                            {teamText(`teamWeb.status.${member.status}`)}
                          </span>
                          {(['PRESENT', 'ABSENT'] as const).map((status) => (
                            <Button
                              key={status}
                              size="sm"
                              variant={
                                (drafts[member.scheduleId]?.status ?? member.status) === status
                                  ? 'primary'
                                  : 'outline'
                              }
                              aria-pressed={
                                (drafts[member.scheduleId]?.status ?? member.status) === status
                              }
                              onClick={() => select(member, status)}
                            >
                              {teamText(`teamWeb.status.${status}`)}
                            </Button>
                          ))}
                        </div>
                        <p className="mt-2 text-xs text-slate-500">
                          {teamText(`teamWeb.gate.${member.gateCheck}`)}
                        </p>
                        {member.locked && (
                          <p className="mt-1 text-xs text-slate-500">
                            {teamText('teamWeb.locked')}
                          </p>
                        )}
                      </fieldset>
                    ))
                  )}
                </div>
                <p className="text-xs font-semibold" role="status">
                  {teamText('teamWeb.selected', { count: entries.length })}
                </p>
                {correcting && (
                  <div className="space-y-2">
                    <label htmlFor={reasonId} className="block text-sm font-semibold">
                      {teamText('teamWeb.reason')}
                    </label>
                    <textarea
                      id={reasonId}
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value);
                        save.reset();
                      }}
                      disabled={save.isPending}
                      minLength={5}
                      maxLength={1000}
                      required
                      className="w-full rounded-xl border border-slate-300 p-3 text-sm focus-visible:outline-2 focus-visible:outline-orange-600"
                    />
                    <p className="text-xs text-slate-500">{teamText('teamWeb.reasonHint')}</p>
                  </div>
                )}
                {changed && (
                  <p role="alert" className="text-sm text-amber-800">
                    {teamText('teamWeb.changed')}
                  </p>
                )}
                {entries.length > 500 && <p role="alert">{teamText('teamWeb.maxEntries')}</p>}
                {save.isError && (
                  <p role="alert" className="text-sm text-rose-700">
                    {userErrorMessage(save.error)}
                  </p>
                )}
                {save.isSuccess && (
                  <p role="status" className="text-sm text-emerald-700">
                    {teamText('teamWeb.saved')}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!valid}
                    isLoading={save.isPending}
                  >
                    {teamText('teamWeb.saveAttendance')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        )
      )}
      <div className="flex justify-end">
        <Button
          variant="outline"
          disabled={save.isPending || attendance.isFetching}
          onClick={() => {
            setDrafts({});
            setContext(null);
            setReason('');
            request.current = null;
            save.reset();
            void attendance.refetch();
          }}
        >
          {teamText('teamWeb.refresh')}
        </Button>
      </div>
    </Dialog>
  );
}
