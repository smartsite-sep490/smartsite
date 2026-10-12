import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SmartDatePicker } from '../../ui';
import { formatShiftRange, formatWorkDate } from '../utils/workforce-format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
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
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
  const client = useMemo(() => new SmartSiteManagementClient(apiUrl), [apiUrl]);
  const cache = useQueryClient();
  const key = ['schedule-assignment-batches', apiUrl, token, siteId];
  const [contractorChoice, setContractor] = useState(
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
        throw new Error('Preview an assignment without conflicts before saving.');
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
      setMessage(`Assigned ${batch.members.length} worker(s) across ${batch.dates.length} day(s).`);
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
          Roster Dispatch
        </div>
        <h3 className="text-base font-extrabold text-[#071A2B] tracking-tight">Assign schedules</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          Assign a team or worker, then preview before saving.
        </p>
      </div>
      {loadError && (
        <p
          role="alert"
          className="text-xs text-red-600 font-semibold bg-red-50 p-2.5 rounded-xl border border-red-200"
        >
          {loadError.message}{' '}
          <button
            className="underline font-bold hover:text-red-800"
            onClick={() => {
              void scopes.refetch();
              void teams.refetch();
              void workers.refetch();
              void grants.refetch();
            }}
          >
            Retry assignment data
          </button>
        </p>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
          <div className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading teams and available shifts…</span>
        </div>
      )}
      {!loading && !loadError && !contractorId && (
        <p
          role="alert"
          className="text-xs text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200"
        >
          No active contractor assignment is available for this site.
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
              Assignment target
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
                Team
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
                Worker
              </button>
            </div>
            <label className="sr-only">
              Assignment target
              <select
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value as 'TEAM' | 'WORKER');
                  setTargetId('');
                  setMembers(undefined);
                }}
              >
                <option value="TEAM">Team</option>
                <option value="WORKER">Worker</option>
              </select>
            </label>
          </div>

          {/* Team / Worker Select */}
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              {target === 'TEAM' ? 'Team' : 'Worker'}
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
              <option value="">Select {target === 'TEAM' ? 'team' : 'worker'}</option>
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
                  Members to assign ({members.length})
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
                      ? 'Deselect all'
                      : 'Select all'}
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
                <p className="text-xs text-slate-400">This team has no active members.</p>
              )}
              <p className="text-[10px] text-slate-400">
                Exclude members who need a different shift, then assign them separately.
              </p>
            </fieldset>
          )}

          {/* Schedule Version */}
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Schedule Version
            </span>
            <select
              required
              className={field}
              value={versionId}
              onChange={(e) => setVersion(e.target.value)}
            >
              <option value="">Select version</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  Version {version.version}
                </option>
              ))}
            </select>
          </label>

          {/* Shift */}
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Shift
            </span>
            <select
              required
              className={field}
              value={shiftId}
              onChange={(e) => setShift(e.target.value)}
            >
              <option value="">Select shift</option>
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
                Unpaid lunch break:{' '}
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
                . Deducted on attendance overlap.
              </span>
            </div>
          )}

          {/* Apply schedule */}
          <label className="block">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Apply schedule
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
              <option value="DAY">One day</option>
              <option value="WEEK">One week</option>
              <option value="REPEAT">Repeat weekly until an end date</option>
            </select>
          </label>

          {/* Date Picker */}
          {mode === 'WEEK' ? (
            <div>
              <SmartDatePicker
                label="Week starting Monday"
                fieldRequired
                value={fromDate}
                onChange={setFrom}
                disablePast={false}
                disabledWeekdays={[0, 2, 3, 4, 5, 6]}
                placeholder="Select a Monday"
              />
              <p className="mt-1 text-xs text-slate-500">
                {validStart
                  ? `Week ends on Sunday, ${weekEnd(fromDate)}.`
                  : 'Select a Monday to continue.'}
              </p>
            </div>
          ) : (
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                {mode === 'DAY' ? 'Work date' : 'Start date'}
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
                End date
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
                Working days
              </legend>
              <div className="grid grid-cols-7 gap-1">
                {weekdays.map((label, index) => {
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
            <span>Preview assignments</span>
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
          {preview.error.message}
        </p>
      )}
      {save.error && (
        <p
          role="alert"
          className="text-xs text-red-700 bg-red-50 p-3 rounded-xl border border-red-200"
        >
          {save.error.message}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="text-xs text-emerald-800 bg-emerald-50 p-3 rounded-xl border border-emerald-200 font-semibold"
        >
          {message}
        </p>
      )}
      {currentPreview && (
        <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Assignment preview
            </h4>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#071A2B] text-white">
              {currentPreview.assignmentCount} shifts
            </span>
          </div>
          <div className="p-3 bg-white rounded-xl border border-slate-200/60 shadow-xs space-y-1.5 text-xs">
            <p className="font-semibold text-slate-800">
              {currentPreview.targetName}:{' '}
              <span className="font-normal text-slate-500">
                {currentPreview.members.length} worker(s) across {currentPreview.dates.length}{' '}
                day(s)
              </span>
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              Members: {currentPreview.members.map((member) => member.workerName).join(', ')}
            </p>
            <div className="max-h-24 overflow-auto text-[11px] text-slate-400 font-mono">
              Dates: {currentPreview.dates.join(', ')}
            </div>
          </div>
          {currentPreview.conflicts.length ? (
            <div className="p-3 bg-red-50 border border-red-200/80 rounded-xl space-y-1.5 text-xs">
              <p role="alert" className="font-bold text-red-700 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                Conflicts found. Nothing will be overwritten.
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
              <span>Ready to schedule · No conflicts found</span>
            </div>
          )}
          <button
            className={action}
            disabled={save.isPending || currentPreview.conflicts.length > 0}
            onClick={() => save.mutate()}
          >
            <span>Confirm assignments</span>
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
        <h4 className="text-sm font-bold">Assignment batches</h4>
        {batches.isPending && <p role="status">Loading batches…</p>}
        {batches.error && (
          <p role="alert">
            {batches.error.message}{' '}
            <button onClick={() => void batches.refetch()}>Retry batches</button>
          </p>
        )}
        {batches.data?.items.length === 0 && (
          <p className="text-xs text-slate-500">No team or bulk assignments yet.</p>
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
            onApplyMembers={() => {
              setContractor(batch.input.contractorId);
              setTarget('TEAM');
              setTargetId(batch.teamId!);
              setVersion(batch.input.scheduleVersionId);
              setShift(batch.input.shiftId);
              setMode(batch.input.mode === 'DAY' ? 'DAY' : 'REPEAT');
              setFrom(today() > batch.input.fromDate ? today() : batch.input.fromDate);
              setTo(batch.input.toDate);
              setDays(batch.input.weekdays);
              setMembers(
                workers.data
                  ?.filter(
                    (worker) =>
                      worker.teamId === batch.teamId &&
                      !batch.members.some((member) => member.workerId === worker.workerId),
                  )
                  .map((worker) => worker.workerId) ?? [],
              );
              preview.reset();
              setMessage(
                'New current members selected. Check remaining dates and preview before applying. Existing schedules stay unchanged.',
              );
            }}
          />
        ))}
        {(batches.data?.total ?? 0) > 10 && (
          <div className="flex gap-2">
            <button disabled={!batchPage} onClick={() => setBatchPage(batchPage - 1)}>
              Previous batches
            </button>
            <button
              disabled={(batchPage + 1) * 10 >= (batches.data?.total ?? 0)}
              onClick={() => setBatchPage(batchPage + 1)}
            >
              Next batches
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
  onApplyMembers,
}: {
  batch: ScheduleAssignmentBatchResponse;
  shifts: ShiftResponse[];
  onChange: (input: ChangeScheduleAssignmentCommand) => Promise<ScheduleAssignmentChangeResponse>;
  onSaved: () => Promise<unknown>;
  onApplyMembers: () => void;
}) {
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
          ? `${result.changedCount} schedule(s) ${actionValue === 'CANCEL' ? 'cancelled' : 'updated'}. ${result.skippedCount ?? 0} started or attendance-protected schedule(s) skipped.`
          : 'Schedule change saved.',
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
        Original assignment: {batch.targetName} · {batch.members.length} worker(s) ·{' '}
        {batch.dates.length} day(s)
      </p>
      <p className="text-xs text-slate-500">
        {batch.dates[0]} – {batch.dates.at(-1)}
      </p>
      <button className="text-xs font-bold text-blue-700" onClick={() => setOpen(!open)}>
        Edit or cancel schedules
      </button>
      <button
        className="ml-3 text-xs font-bold text-blue-700"
        onClick={() => {
          mutation.reset();
          setScope('UNSTARTED');
          setAction('CHANGE_SHIFT');
          setOpen(true);
        }}
      >
        Edit unstarted schedules
      </button>
      {batch.teamId && (
        <button
          disabled={!batch.dates.some((date) => date >= today())}
          className="ml-3 text-xs font-bold text-blue-700 disabled:opacity-50"
          onClick={onApplyMembers}
        >
          Apply remaining dates to new members
        </button>
      )}
      {open && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <label className="block text-xs">
            Action
            <select
              className={field}
              value={actionValue}
              onChange={(e) => setAction(e.target.value as typeof actionValue)}
            >
              <option value="CANCEL">Cancel schedules</option>
              <option value="CHANGE_SHIFT">Change shift</option>
            </select>
          </label>
          <label className="block text-xs">
            Apply change to
            <select
              className={field}
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="DAY">This day only</option>
              <option value="FROM_DATE">From this date onward</option>
              <option value="UNSTARTED">All unstarted schedules in this batch</option>
            </select>
          </label>
          {scope !== 'UNSTARTED' && (
            <label className="block text-xs">
              Change date
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
            Affected workers
            <select className={field} value={worker} onChange={(e) => setWorker(e.target.value)}>
              <option value="">All assigned members</option>
              {batch.members.map((member) => (
                <option key={member.workerId} value={member.workerId}>
                  {member.workerName}
                </option>
              ))}
            </select>
          </label>
          {actionValue === 'CHANGE_SHIFT' && (
            <label className="block text-xs">
              Replacement shift
              <select
                required
                className={field}
                value={shift}
                onChange={(e) => setShift(e.target.value)}
              >
                <option value="">Select shift</option>
                {shifts.map((shift) => (
                  <option key={shift.id} value={shift.id}>
                    {shift.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-xs">
            Change reason
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
              ? 'Apply once to all unstarted schedules in this batch. Started shifts and days with attendance are skipped. Linked leave, overtime or shift requests must be resolved first.'
              : 'Started shifts and days with attendance are protected. Historical attendance is retained.'}
          </p>
          <button className={action} disabled={mutation.isPending || !reason.trim()} type="submit">
            Confirm schedule change
          </button>
        </form>
      )}
      {mutation.error && (
        <p role="alert" className="text-xs text-red-700">
          {mutation.error.message}
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
