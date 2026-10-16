import { useManagementClient } from '../../../features/auth/auth-session';
import { localizedError, localizeMessage } from '../../../i18n/messages';
import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { SmartDatePicker } from '../../ui';
import { formatShiftRange, formatWorkDate } from '../utils/workforce-format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import type {
  ChangeScheduleAssignmentCommand,
  ScheduleAssignmentChangeResponse,
  ScheduleAssignmentBatchResponse,
  ScheduleAssignmentInput,
  ScheduleVersionResponse,
  ShiftResponse,
} from '@smartsite/contracts';

const field =
  'mt-1 block w-full rounded-xl border border-slate-200/90 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-900 shadow-[inset_0_1px_1px_rgba(0,0,0,0.02)] hover:border-slate-300 focus:bg-white focus:border-[#071A2B] focus:ring-2 focus:ring-slate-900/10 focus:outline-none transition-all cursor-pointer';
const action =
  'w-full flex items-center justify-center gap-2 rounded-xl bg-[#071A2B] hover:bg-slate-800 active:scale-[0.98] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none cursor-pointer';
const weekdays = () => [
  tr('common.mon'),
  tr('common.tue'),
  tr('common.wed'),
  tr('common.thu'),
  tr('common.fri'),
  tr('common.sat'),
  tr('common.sun'),
];
function today() {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}
function clock(value: string, timezone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
function weekEnd(date: string) {
  const at = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(at.getTime())) return '';
  at.setUTCDate(at.getUTCDate() + 6);
  return at.toISOString().slice(0, 10);
}
async function allPages<T>(read: (offset: number) => Promise<{ items: T[]; total: number }>) {
  const items: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await read(offset);
    items.push(...page.items);
    if (items.length >= page.total || !page.items.length) return items;
  }
}

export function ScheduleAssignmentForm({
  apiUrl,
  token,
  siteId,
  shifts,
  versions,
  onScopeChange,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  shifts: ShiftResponse[];
  versions: ScheduleVersionResponse[];
  onScopeChange?: (scope: { siteId: string; contractorId: string }) => void;
}) {
  useTranslation();

  const client = useManagementClient(apiUrl);
  const cache = useQueryClient();
  const key = ['schedule-assignment-batches', apiUrl, token, siteId];
  const [contractorChoice] = useState(
    () => new URLSearchParams(window.location.search).get('contractorId') ?? '',
  );
  const [target, setTarget] = useState<'TEAM' | 'WORKER'>('TEAM');
  const [targetId, setTargetId] = useState(
    () => new URLSearchParams(window.location.search).get('teamId') ?? '',
  );
  const [versionChoice, setVersion] = useState('');
  const [shiftId, setShift] = useState('');
  const [mode, setMode] = useState<ScheduleAssignmentInput['mode']>('DAY');
  const [fromDate, setFrom] = useState(today());
  const [toDate, setTo] = useState(today());
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [selectedMembers, setMembers] = useState<string[] | undefined>(() => {
    const workerId = new URLSearchParams(window.location.search).get('workerId');
    return workerId ? [workerId] : undefined;
  });
  const [batchPage, setBatchPage] = useState(0);
  const [message, setMessage] = useState('');
  const request = useRef<{ key: string; id: string } | null>(null);
  const scopes = useQuery({
    queryKey: ['contractor-dashboard-scopes', apiUrl, token],
    queryFn: () => client.contractorDashboardScopes(token),
  });
  const availableScopes = scopes.data?.items.filter((scope) => scope.siteId === siteId) ?? [];
  const contractorId = contractorChoice
    ? (availableScopes.find((scope) => scope.contractorId === contractorChoice)?.contractorId ?? '')
    : (availableScopes[0]?.contractorId ?? '');
  const versionId = versionChoice || versions[0]?.id || '';
  useEffect(() => {
    onScopeChange?.({ siteId, contractorId });
  }, [siteId, contractorId, onScopeChange]);
  const teams = useQuery({
    queryKey: [...key, contractorId, 'teams'],
    queryFn: () =>
      allPages((offset) =>
        client.listContractorTeams(token, siteId, contractorId, {
          status: 'ACTIVE',
          offset,
          limit: 100,
        }),
      ),
    enabled: Boolean(contractorId),
  });
  const workers = useQuery({
    queryKey: [...key, contractorId, 'workers'],
    queryFn: () =>
      allPages((offset) =>
        client.listContractorTeamWorkers(token, siteId, contractorId, { offset, limit: 100 }),
      ),
    enabled: Boolean(contractorId),
  });
  const grants = useQuery({
    queryKey: [...key, contractorId, 'shift-grants'],
    queryFn: () =>
      allPages((offset) =>
        client.listShiftContractorAssignments(token, siteId, { offset, limit: 100 }),
      ),
    enabled: Boolean(contractorId),
  });
  const availableShifts = shifts.filter(
    (shift) =>
      !shift.archivedAt &&
      grants.data?.some(
        (grant) => grant.contractorId === contractorId && grant.shiftId === shift.id,
      ),
  );
  const members = workers.data?.filter((worker) => worker.teamId === targetId) ?? [];
  const input: ScheduleAssignmentInput = {
    contractorId,
    scheduleVersionId: versionId,
    shiftId,
    target,
    ...(target === 'TEAM'
      ? { teamId: targetId, ...(selectedMembers ? { selectedWorkerIds: selectedMembers } : {}) }
      : { workerId: targetId }),
    mode,
    fromDate,
    toDate: mode === 'DAY' ? fromDate : mode === 'WEEK' ? weekEnd(fromDate) : toDate,
    weekdays: days,
  };
  const inputKey = JSON.stringify(input);
  const validStart =
    Boolean(fromDate) && (mode !== 'WEEK' || new Date(`${fromDate}T00:00:00Z`).getUTCDay() === 1);
  const preview = useMutation({
    mutationFn: (value: ScheduleAssignmentInput) =>
      client.previewScheduleAssignment(token, siteId, value),
  });
  const currentPreview =
    preview.data && JSON.stringify(preview.variables) === inputKey ? preview.data : undefined;
  const invalidate = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: key }),
      cache.invalidateQueries({ queryKey: ['worker-schedules', siteId] }),
      cache.invalidateQueries({ queryKey: ['worker-schedules'] }),
    ]);
  const save = useMutation({
    mutationFn: () => {
      if (!currentPreview || currentPreview.conflicts.length)
        throw new Error(
          tr('schedule_assignment_form.preview_an_assignment_without_conflicts_before_saving'),
        );
      const fingerprint = JSON.stringify([input, currentPreview.fingerprint]);
      if (request.current?.key !== fingerprint)
        request.current = { key: fingerprint, id: crypto.randomUUID() };
      return client.createScheduleAssignment(token, siteId, {
        ...input,
        requestId: request.current.id,
        expectedFingerprint: currentPreview.fingerprint,
      });
    },
    onSuccess: async (batch) => {
      setMessage(
        tr('schedule_assignment_form.assigned_value_worker_s_across_value_day_s', {
          value1: batch.members.length,
          value2: batch.dates.length,
        }),
      );
      setTargetId('');
      setMembers(undefined);
      preview.reset();
      request.current = null;
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) preview.reset();
    },
  });
  const batches = useQuery({
    queryKey: [...key, contractorId, batchPage],
    queryFn: () =>
      client.listScheduleAssignments(token, siteId, contractorId, {
        offset: batchPage * 10,
        limit: 10,
      }),
    enabled: Boolean(contractorId),
    refetchInterval: 30000,
  });
  const loading =
    scopes.isPending ||
    Boolean(contractorId && (teams.isPending || workers.isPending || grants.isPending));
  const loadError = scopes.error || teams.error || workers.error || grants.error;
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] uppercase tracking-[0.2em] font-bold bg-orange-50 text-orange-600 border border-orange-200/60 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
          {tr('common.roster_dispatch')}
        </div>
        <h3 className="text-base font-extrabold text-[#071A2B] tracking-tight">
          {tr('common.assign_schedules')}
        </h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          {tr('schedule_assignment_form.assign_a_team_or_worker_then_preview_before_saving')}
        </p>
      </div>
      {loadError && (
        <p
          role="alert"
          className="text-xs text-red-600 font-semibold bg-red-50 p-2.5 rounded-xl border border-red-200"
        >
          {localizedError(loadError.message)}{' '}
          <button
            className="underline font-bold hover:text-red-800"
            onClick={() => {
              void scopes.refetch();
              void teams.refetch();
              void workers.refetch();
              void grants.refetch();
            }}
          >
            {tr('common.retry_assignment_data')}
          </button>
        </p>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
          <div className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span>{tr('schedule_assignment_form.loading_teams_and_available_shifts')}</span>
        </div>
      )}
      {!loading && !loadError && !contractorId && (
        <p
          role="alert"
          className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200"
        >
          {tr(
            'schedule_assignment_form.no_active_contractor_assignment_is_available_for_this_site',
          )}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!validStart) return;
          setMessage('');
          preview.mutate(input);
        }}
        className="space-y-3.5"
      >
        <fieldset
          disabled={loading || Boolean(loadError) || save.isPending || !contractorId}
          className="space-y-3.5"
        >
          {/* Assignment target Segmented Control */}
          <div className="space-y-1.5">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              {tr('common.assignment_target')}
            </span>
            <div className="grid grid-cols-2 p-1 bg-slate-100/80 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => {
                  setTarget('TEAM');
                  setTargetId('');
                  setMembers(undefined);
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  target === 'TEAM'
                    ? 'bg-white text-[#071A2B] shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {tr('common.team')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTarget('WORKER');
                  setTargetId('');
                  setMembers(undefined);
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  target === 'WORKER'
                    ? 'bg-white text-[#071A2B] shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {tr('common.worker')}
              </button>
            </div>
            <label className="sr-only">
              {tr('common.assignment_target')}
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value as 'TEAM' | 'WORKER');
                  setTargetId('');
                  setMembers(undefined);
                }}
              >
                <option value="TEAM">{tr('common.team')}</option>
                <option value="WORKER">{tr('common.worker')}</option>
              </select>
            </label>
          </div>

          {/* Team / Worker Select */}
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              {target === 'TEAM' ? tr('common.team') : tr('common.worker')}
            </span>
            <select
              required
              className={field}
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setMembers(undefined);
              }}
            >
              <option value="">
                {tr('common.select_value', { value1: target === 'TEAM' ? 'team' : 'worker' })}
              </option>
              {target === 'TEAM'
                ? teams.data?.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name} ({team.memberCount})
                    </option>
                  ))
                : workers.data?.map((worker) => (
                    <option key={worker.workerId} value={worker.workerId}>
                      {worker.displayName}
                    </option>
                  ))}
            </select>
          </label>

          {/* Team Members Exclude List */}
          {target === 'TEAM' && targetId && (
            <fieldset className="rounded-xl border border-slate-200/90 bg-slate-50/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  {tr('schedule_assignment_form.members_to_assign_value', {
                    value1: members.length,
                  })}
                </legend>
                {members.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedMembers || selectedMembers.length === members.length) {
                        setMembers([]);
                      } else {
                        setMembers(members.map((m) => m.workerId));
                      }
                    }}
                    className="text-[10px] font-bold text-orange-600 hover:underline"
                  >
                    {!selectedMembers || selectedMembers.length === members.length
                      ? tr('common.deselect_all_967549')
                      : tr('common.select_all_1fc9a3')}
                  </button>
                )}
              </div>
              {members.length ? (
                <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                  {members.map((member) => {
                    const checked = !selectedMembers || selectedMembers.includes(member.workerId);
                    return (
                      <label
                        key={member.workerId}
                        className={`flex items-center gap-2 p-2 rounded-lg text-xs font-medium transition-all cursor-pointer select-none ${
                          checked
                            ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60'
                            : 'text-slate-500 hover:bg-slate-100/60'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 rounded text-[#071A2B] focus:ring-0 border-slate-300"
                          checked={checked}
                          onChange={(e) => {
                            const selected = selectedMembers ?? members.map((m) => m.workerId);
                            setMembers(
                              e.target.checked
                                ? [...selected, member.workerId]
                                : selected.filter((id) => id !== member.workerId),
                            );
                          }}
                        />
                        <span>{member.displayName}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  {tr('schedule_assignment_form.this_team_has_no_active_members')}
                </p>
              )}
              <p className="text-[10px] text-slate-400">
                {tr(
                  'schedule_assignment_form.exclude_members_who_need_a_different_shift_then_assign_them_separately',
                )}
              </p>
            </fieldset>
          )}

          {/* Schedule Version */}
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              {tr('common.schedule_version')}
            </span>
            <select
              required
              className={field}
              value={versionId}
              onChange={(e) => setVersion(e.target.value)}
            >
              <option value="">{tr('common.select_version')}</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {tr('common.version_value', { value1: version.version })}
                </option>
              ))}
            </select>
          </label>

          {/* Shift */}
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              {tr('common.shift')}
            </span>
            <select
              required
              className={field}
              value={shiftId}
              onChange={(e) => setShift(e.target.value)}
            >
              <option value="">{tr('common.select_shift')}</option>
              {availableShifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.name} · {formatShiftRange(shift.startsAt, shift.endsAt, shift.timezone)} (
                  {shift.timezone})
                </option>
              ))}
            </select>
          </label>
          {shifts.find((shift) => shift.id === shiftId)?.breakStartsAt && (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span>
                {tr('common.unpaid_lunch_break')}{' '}
                <strong className="text-slate-700">
                  {clock(
                    shifts.find((shift) => shift.id === shiftId)!.breakStartsAt!,
                    shifts.find((shift) => shift.id === shiftId)!.timezone,
                  )}
                  –
                  {clock(
                    shifts.find((shift) => shift.id === shiftId)!.breakEndsAt!,
                    shifts.find((shift) => shift.id === shiftId)!.timezone,
                  )}
                </strong>
                {tr('schedule_assignment_form.deducted_on_attendance_overlap')}
              </span>
            </div>
          )}

          {/* Apply schedule */}
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              {tr('common.apply_schedule')}
            </span>
            <select
              className={field}
              value={mode}
              onChange={(e) => {
                const selected = e.target.value as ScheduleAssignmentInput['mode'];
                setMode(selected);
                if (selected === 'WEEK') {
                  if (new Date(`${fromDate}T00:00:00Z`).getUTCDay() !== 1) setFrom('');
                }
              }}
            >
              <option value="DAY">{tr('common.one_day')}</option>
              <option value="WEEK">{tr('common.one_week')}</option>
              <option value="REPEAT">
                {tr('schedule_assignment_form.repeat_weekly_until_an_end_date')}
              </option>
            </select>
          </label>

          {/* Date Picker */}
          {mode === 'WEEK' ? (
            <div>
              <SmartDatePicker
                label={tr('common.week_starting_monday')}
                fieldRequired
                value={fromDate}
                onChange={setFrom}
                disablePast={false}
                disabledWeekdays={[0, 2, 3, 4, 5, 6]}
                placeholder={tr('common.select_a_monday')}
              />
              <p className="mt-1 text-xs text-slate-500">
                {validStart
                  ? tr('schedule_assignment_form.week_ends_on_sunday_value', {
                      value1: weekEnd(fromDate),
                    })
                  : tr('schedule_assignment_form.select_a_monday_to_continue')}
              </p>
            </div>
          ) : (
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                {mode === 'DAY' ? tr('common.work_date') : tr('common.start_date')}
              </span>
              <input
                required
                className={field}
                type="date"
                value={fromDate}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
          )}

          {mode === 'REPEAT' && (
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                {tr('common.end_date')}
              </span>
              <input
                required
                className={field}
                type="date"
                min={fromDate}
                value={toDate}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          )}

          {/* Working Days Selector Chips */}
          {mode !== 'DAY' && (
            <fieldset className="space-y-1.5">
              <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {tr('common.working_days')}
              </legend>
              <div className="grid grid-cols-7 gap-1">
                {weekdays().map((label, index) => {
                  const isChecked = days.includes(index + 1);
                  return (
                    <label
                      key={label}
                      className={`relative flex items-center justify-center py-2 rounded-xl text-xs font-bold transition-all cursor-pointer select-none text-center ${
                        isChecked
                          ? 'bg-[#071A2B] text-white shadow-xs scale-[1.02]'
                          : 'bg-slate-100/80 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isChecked}
                        onChange={(e) =>
                          setDays(
                            e.target.checked
                              ? [...days, index + 1].sort()
                              : days.filter((day) => day !== index + 1),
                          )
                        }
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {/* Preview assignments CTA */}
          <button
            className={action}
            type="submit"
            disabled={
              preview.isPending ||
              !validStart ||
              !shiftId ||
              !targetId ||
              !days.length ||
              selectedMembers?.length === 0
            }
          >
            <span>{tr('common.preview_assignments')}</span>
            <span
              aria-hidden="true"
              className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px]"
            >
              →
            </span>
          </button>
        </fieldset>
      </form>
      {preview.error && (
        <p
          role="alert"
          className="text-xs text-red-700 bg-red-50 p-3 rounded-xl border border-red-200"
        >
          {localizedError(preview.error.message)}
        </p>
      )}
      {save.error && (
        <p
          role="alert"
          className="text-xs text-red-700 bg-red-50 p-3 rounded-xl border border-red-200"
        >
          {localizedError(save.error.message)}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="text-xs text-emerald-800 bg-emerald-50 p-3 rounded-xl border border-emerald-200 font-semibold"
        >
          {localizeMessage(message)}
        </p>
      )}
      {currentPreview && (
        <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              {tr('common.assignment_preview')}
            </h4>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#071A2B] text-white">
              {tr('common.value_shifts', { value1: currentPreview.assignmentCount })}
            </span>
          </div>
          <div className="p-3 bg-white rounded-xl border border-slate-200/60 shadow-xs space-y-1.5 text-xs">
            <p className="font-semibold text-slate-800">
              {currentPreview.targetName}:{' '}
              <span className="font-normal text-slate-500">
                {tr('schedule_assignment_form.value_worker_s_across_value_day_s', {
                  value1: currentPreview.members.length,
                  value2: currentPreview.dates.length,
                })}
              </span>
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {tr('common.members_value', {
                value1: currentPreview.members.map((member) => member.workerName).join(', '),
              })}
            </p>
            <div className="max-h-24 overflow-auto text-[11px] text-slate-400 font-mono">
              {tr('common.dates_value', { value1: currentPreview.dates.join(', ') })}
            </div>
          </div>
          {currentPreview.conflicts.length ? (
            <div className="p-3 bg-red-50 border border-red-200/80 rounded-xl space-y-1.5 text-xs">
              <p role="alert" className="font-bold text-red-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                {tr('schedule_assignment_form.conflicts_found_nothing_will_be_overwritten')}
              </p>
              <ul className="max-h-32 overflow-auto text-[11px] text-red-600 font-mono space-y-0.5">
                {currentPreview.conflicts.map((item) => (
                  <li key={item.scheduleId}>
                    • {item.workerName} · {formatWorkDate(item.workDate)} · {item.shiftName}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-bold bg-emerald-50 border border-emerald-200/80 p-2.5 rounded-xl">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>{tr('schedule_assignment_form.ready_to_schedule_no_conflicts_found')}</span>
            </div>
          )}
          <button
            className={action}
            disabled={save.isPending || currentPreview.conflicts.length > 0}
            onClick={() => save.mutate()}
          >
            <span>{tr('common.confirm_assignments')}</span>
            <span
              aria-hidden="true"
              className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-[10px]"
            >
              ✓
            </span>
          </button>
        </div>
      )}
      <div className="space-y-3 border-t border-slate-200 pt-4">
        <h4 className="text-sm font-bold">{tr('common.assignment_batches')}</h4>
        {batches.isPending && <p role="status">{tr('common.loading_batches')}</p>}
        {batches.error && (
          <p role="alert">
            {localizedError(batches.error.message)}{' '}
            <button onClick={() => void batches.refetch()}>{tr('common.retry_batches')}</button>
          </p>
        )}
        {batches.data?.items.length === 0 && (
          <p className="text-xs text-slate-500">
            {tr('schedule_assignment_form.no_team_or_bulk_assignments_yet')}
          </p>
        )}
        {batches.data?.items.map((batch) => (
          <BatchEditor
            key={batch.id}
            batch={batch}
            shifts={availableShifts}
            onChange={(command) =>
              client.changeScheduleAssignment(token, siteId, batch.id, command)
            }
            onSaved={invalidate}
          />
        ))}
        {(batches.data?.total ?? 0) > 10 && (
          <div className="flex gap-2">
            <button disabled={!batchPage} onClick={() => setBatchPage(batchPage - 1)}>
              {tr('common.previous_batches')}
            </button>
            <button
              disabled={(batchPage + 1) * 10 >= (batches.data?.total ?? 0)}
              onClick={() => setBatchPage(batchPage + 1)}
            >
              {tr('common.next_batches')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function BatchEditor({
  batch,
  shifts,
  onChange,
  onSaved,
}: {
  batch: ScheduleAssignmentBatchResponse;
  shifts: ShiftResponse[];
  onChange: (input: ChangeScheduleAssignmentCommand) => Promise<ScheduleAssignmentChangeResponse>;
  onSaved: () => Promise<unknown>;
}) {
  useTranslation();

  const [open, setOpen] = useState(false);
  const [actionValue, setAction] = useState<ChangeScheduleAssignmentCommand['action']>('CANCEL');
  const [scope, setScope] = useState<ChangeScheduleAssignmentCommand['scope']>('DAY');
  const [date, setDate] = useState(
    batch.dates.find((day) => day >= today()) ?? batch.dates[0] ?? today(),
  );
  const [worker, setWorker] = useState('');
  const [shift, setShift] = useState('');
  const [reason, setReason] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const request = useRef<{ key: string; id: string } | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        expectedVersion: batch.version,
        action: actionValue,
        scope,
        workDate: scope === 'UNSTARTED' ? (batch.dates[0] ?? date) : date,
        ...(worker ? { workerId: worker } : {}),
        ...(actionValue === 'CHANGE_SHIFT' ? { shiftId: shift } : {}),
        reason: reason.trim(),
      };
      const key = JSON.stringify(input);
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
      return onChange({ ...input, requestId: request.current.id });
    },
    onSuccess: async (result) => {
      setSavedMessage(
        result.changedCount !== undefined
          ? tr(
              'schedule_assignment_form.value_schedule_s_value_value_started_or_attendance_protected_schedule_s_skipped',
              {
                value1: result.changedCount,
                value2: actionValue === 'CANCEL' ? tr('actions.cancelled') : tr('actions.updated'),
                value3: result.skippedCount ?? 0,
              },
            )
          : tr('common.schedule_change_saved'),
      );
      setOpen(false);
      setReason('');
      request.current = null;
      await onSaved();
    },
  });
  return (
    <article className="space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-bold">
        {tr('schedule_assignment_form.original_assignment_value_value_worker_s_value_day_s', {
          value1: batch.targetName,
          value2: batch.members.length,
          value3: batch.dates.length,
        })}
      </p>
      <p className="text-xs text-slate-500">
        {batch.dates[0]} – {batch.dates.at(-1)}
      </p>
      <button
        className="text-xs font-bold text-blue-700"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {tr('schedule_assignment_form.edit_or_cancel_schedules')}
      </button>
      {open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="block text-xs">
            {tr('common.action')}
            <select
              className={field}
              value={actionValue}
              onChange={(e) => setAction(e.target.value as typeof actionValue)}
            >
              <option value="CANCEL">{tr('common.cancel_schedules')}</option>
              <option value="CHANGE_SHIFT">{tr('common.change_shift')}</option>
            </select>
          </label>
          <label className="block text-xs">
            {tr('common.apply_change_to')}
            <select
              className={field}
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="DAY">{tr('common.this_day_only')}</option>
              <option value="FROM_DATE">
                {tr('schedule_assignment_form.from_this_date_onward')}
              </option>
              <option value="UNSTARTED">
                {tr('schedule_assignment_form.all_unstarted_schedules_in_this_batch')}
              </option>
            </select>
          </label>
          {scope !== 'UNSTARTED' && (
            <label className="block text-xs">
              {tr('common.change_date')}
              <input
                required
                className={field}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          )}
          <label className="block text-xs">
            {tr('common.affected_workers')}
            <select className={field} value={worker} onChange={(e) => setWorker(e.target.value)}>
              <option value="">{tr('common.all_assigned_members')}</option>
              {batch.members.map((member) => (
                <option key={member.workerId} value={member.workerId}>
                  {member.workerName}
                </option>
              ))}
            </select>
          </label>
          {actionValue === 'CHANGE_SHIFT' && (
            <label className="block text-xs">
              {tr('common.replacement_shift')}
              <select
                required
                className={field}
                value={shift}
                onChange={(e) => setShift(e.target.value)}
              >
                <option value="">{tr('common.select_shift')}</option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-xs">
            {tr('common.change_reason')}
            <input
              required
              maxLength={1000}
              className={field}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <p className="text-xs text-slate-500">
            {scope === 'UNSTARTED'
              ? tr(
                  'schedule_assignment_form.apply_once_to_all_unstarted_schedules_in_this_batch_started_shifts_and_days_with_a',
                )
              : tr(
                  'schedule_assignment_form.started_shifts_and_days_with_attendance_are_protected_historical_attendance_is_ret',
                )}
          </p>
          <button className={action} disabled={mutation.isPending || !reason.trim()} type="submit">
            {tr('common.confirm_schedule_change')}
          </button>
        </form>
      )}
      {mutation.error && (
        <p role="alert" className="text-xs text-red-700">
          {localizedError(mutation.error.message)}
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="text-xs text-emerald-700">
          {savedMessage}
        </p>
      )}
    </article>
  );
}
