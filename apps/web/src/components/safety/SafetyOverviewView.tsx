import { useTranslation } from 'react-i18next';
import { translate as tr, uiLocale } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  type WorkflowProps,
  fieldClass,
  cardClass,
  buttonClass,
  date,
  label,
} from './safety-workflow';
import { RequestError, Pager } from './SafetyWorkflowUi';
import { SafetyZoneContext } from './SafetyZoneContext';
import {
  localDay,
  browserTimezone,
  dayWindow,
  overviewContractors,
  safetyTeams,
  type RelatedAlertFilter,
} from './safety-context';
export function SafetyOverviewView(
  p: WorkflowProps & {
    active: boolean;
    canAlerts: boolean;
    onAlerts: (filter: RelatedAlertFilter) => void;
    onChecklist: (teamId: string, day: string) => void;
    onViewChecklists: (teamId: string, day: string, name: string) => void;
    canAssign: boolean;
  },
) {
  useTranslation();

  const [day, setDay] = useState(localDay),
    [mode, setMode] = useState<'day' | 'week'>('day'),
    [contractorId, setContractor] = useState(''),
    [teamFilter, setTeamFilter] = useState(''),
    [selected, setSelected] = useState(''),
    [offset, setOffset] = useState(0),
    [unassignedOffset, setUnassignedOffset] = useState(0),
    [workerOffset, setWorkerOffset] = useState(0),
    [mobileDetail, setMobileDetail] = useState(false),
    [workersOpen, setWorkersOpen] = useState(false);
  const timezone = browserTimezone(),
    base = ['safety-workflow', p.apiUrl, p.scope, p.siteId] as const;
  const contractors = useQuery({
    queryKey: [...base, 'overview-contractor-options', day, mode, timezone],
    queryFn: ({ signal }) =>
      overviewContractors(p, mode === 'week' ? weekEnd(day) : day, timezone, signal),
    enabled: p.active,
    retry: false,
  });
  const options = useQuery({
    queryKey: [...base, 'team-options', day, mode, timezone, contractorId],
    queryFn: ({ signal }) =>
      safetyTeams(p, mode === 'week' ? weekEnd(day) : day, timezone, contractorId, signal),
    enabled: p.active,
    retry: false,
  });
  const query = useQuery({
    queryKey: [
      ...base,
      'overview',
      day,
      timezone,
      contractorId,
      teamFilter,
      offset,
      unassignedOffset,
    ],
    queryFn: ({ signal }) =>
      p.client.getSafetyOverview(
        p.token,
        p.siteId,
        {
          date: day,
          timezone,
          contractorId: contractorId || undefined,
          teamId: teamFilter || undefined,
          offset,
          limit: 20,
          unassignedOffset,
          unassignedLimit: 20,
        },
        { signal },
      ),
    enabled: p.active,
    refetchInterval: p.active ? 30000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const week = useQuery({
    queryKey: [...base, 'overview-week', day, timezone, contractorId, teamFilter, offset],
    queryFn: ({ signal }) =>
      p.client.getSafetyWeek(
        p.token,
        p.siteId,
        {
          date: day,
          timezone,
          contractorId: contractorId || undefined,
          teamId: teamFilter || undefined,
          offset,
          limit: 20,
        },
        { signal },
      ),
    enabled: p.active && mode === 'week',
    refetchInterval: p.active && mode === 'week' ? 30000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const page = mode === 'week' ? week.data?.teams : query.data?.teams;
  const selectedId = page?.items.some((t) => t.id === selected)
    ? selected
    : (page?.items[0]?.id ?? '');
  const detail = useQuery({
    queryKey: [...base, 'overview-team', selectedId, day, timezone, workerOffset],
    queryFn: ({ signal }) =>
      p.client.getSafetyTeam(
        p.token,
        p.siteId,
        selectedId,
        { date: day, timezone, offset: workerOffset, limit: 20 },
        { signal },
      ),
    enabled: p.active && !!selectedId,
    refetchInterval: p.active ? 30000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const jobs = useQuery({
    queryKey: [...base, 'overview-jobs', selectedId, day, timezone],
    queryFn: ({ signal }) =>
      p.client.listSafetyChecklists(
        p.token,
        p.siteId,
        { teamId: selectedId, fromDate: day, toDate: day, timezone, offset: 0, limit: 5 },
        { signal },
      ),
    enabled: p.active && !!selectedId,
    refetchInterval: p.active ? 30000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const reset = () => {
    setSelected('');
    setOffset(0);
    setUnassignedOffset(0);
    setWorkerOffset(0);
    setMobileDetail(false);
    setWorkersOpen(false);
  };
  const changeDay = (next: string) => {
    setDay(next);
    reset();
  };
  const moveWeek = (days: number) => {
    const next = new Date(day + 'T12:00:00');
    next.setDate(next.getDate() + days);
    changeDay(localDay(next));
  };
  const selectTeam = (id: string, nextDay = day) => {
    setSelected(id);
    setDay(nextDay);
    setWorkerOffset(0);
    setWorkersOpen(false);
    setMobileDetail(true);
  };
  const alerts = (zoneId?: string, cameraExternalId?: string) =>
    p.onAlerts({
      contextTeamId: selectedId,
      attentionOnly: true,
      zoneId,
      cameraExternalId,
      ...dayWindow(day),
      caption:
        (detail.data?.contractorName ?? tr('common.contractor')) +
        ' · ' +
        (detail.data?.name ?? tr('labels.TEAM')) +
        ' · ' +
        day,
    });
  const current = detail.data;
  return (
    <div className="space-y-3 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{tr('safety_workspace.safety_overview')}</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {tr('safety_workspace.planned_teams_work_preparation_and_related_alerts')}
          </p>
        </div>
        <button
          className={buttonClass}
          onClick={() => {
            void query.refetch();
            if (mode === 'week') void week.refetch();
            void detail.refetch();
            void jobs.refetch();
            void options.refetch();
            void contractors.refetch();
          }}
        >
          {tr('safety_workspace.refresh_overview')}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white p-3">
        <div className="flex gap-1" aria-label={tr('safety_workspace.overview_period')}>
          <button
            className={buttonClass}
            aria-pressed={mode === 'day'}
            onClick={() => {
              setMode('day');
              reset();
            }}
          >
            {tr('labels.DAY')}
          </button>
          <button
            className={buttonClass}
            aria-pressed={mode === 'week'}
            onClick={() => {
              setMode('week');
              reset();
            }}
          >
            {tr('labels.WEEK')}
          </button>
        </div>
        <label className="text-xs font-semibold">
          {tr('common.work_date')}
          <input
            className={fieldClass}
            type="date"
            required
            value={day}
            onChange={(e) => {
              if (e.target.value) changeDay(e.target.value);
            }}
          />
        </label>
        <button className={buttonClass} onClick={() => changeDay(localDay())}>
          {tr('calendar.today')}
        </button>
        <label className="min-w-0 w-full sm:w-44 text-xs font-semibold">
          {tr('common.contractor')}
          <select
            className={fieldClass}
            value={contractorId}
            onChange={(e) => {
              setContractor(e.target.value);
              setTeamFilter('');
              reset();
            }}
          >
            <option value="">{tr('safety_workspace.all_contractors')}</option>
            {contractors.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 w-full sm:w-44 text-xs font-semibold">
          {tr('labels.TEAM')}
          <select
            className={fieldClass}
            value={teamFilter}
            onChange={(e) => {
              setTeamFilter(e.target.value);
              reset();
            }}
          >
            <option value="">{tr('common.all_teams_bf65fc')}</option>
            {options.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--text-secondary)]">
        <span>
          {tr('safety_workspace.timezone_value1_scheduled_does_not_mean_present', {
            value1: timezone,
          })}
        </span>
        <span>
          {tr('safety_workspace.value1_refreshes_every_30_seconds_while_visible', {
            value1: query.data?.updatedAt
              ? tr('safety_workspace.updated_value1', { value1: date(query.data.updatedAt) })
              : tr('safety_workspace.update_time_unavailable'),
          })}
        </span>
      </div>
      <RequestError error={query.error} retry={() => void query.refetch()} />
      <RequestError error={contractors.error} retry={() => void contractors.refetch()} />
      <RequestError error={options.error} retry={() => void options.refetch()} />
      {mode === 'week' && (
        <section className="min-w-0" aria-label={tr('safety_workspace.weekly_schedule')}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button className={buttonClass} onClick={() => moveWeek(-7)}>
              {tr('common.previous_week')}
            </button>
            <strong className="text-sm">
              {week.data?.weekStart} – {week.data?.weekEnd}
            </strong>
            <button className={buttonClass} onClick={() => moveWeek(7)}>
              {tr('common.next_week')}
            </button>
          </div>
          <RequestError error={week.error} retry={() => void week.refetch()} />
          {week.isPending && <p>{tr('safety_workspace.loading_week')}</p>}
          <div className="lg:hidden flex flex-wrap gap-1">
            {week.data?.teams.items[0]?.days.map((d) => (
              <button
                key={d.date}
                className={buttonClass}
                aria-pressed={day === d.date}
                onClick={() => {
                  setDay(d.date);
                  setWorkerOffset(0);
                }}
              >
                {d.date.slice(5)}
              </button>
            ))}
          </div>
          <div className="hidden lg:block overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs">
              <caption className="sr-only">
                {tr('safety_workspace.planned_work_by_team_and_day')}
              </caption>
              <thead>
                <tr>
                  <th className="p-2 text-left">{tr('labels.TEAM')}</th>
                  {week.data?.teams.items[0]?.days.map((d) => (
                    <th key={d.date} className="p-2">
                      {d.date.slice(5)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {week.data?.teams.items.map((t) => (
                  <tr key={t.id} className="border-t">
                    <th className="p-2 text-left font-normal">
                      {t.contractorName}
                      <strong className="block">{t.name}</strong>
                    </th>
                    {t.days.map((d) => (
                      <td key={d.date} className="p-1 align-top">
                        <button
                          className={
                            'w-full rounded-lg p-2 text-left ' +
                            (selectedId === t.id && day === d.date
                              ? 'bg-[var(--surface-bone)] ring-1 ring-[var(--accent)]'
                              : 'hover:bg-[var(--surface-bone)]')
                          }
                          aria-label={tr('safety_workspace.value1_on_value2', {
                            value1: t.name,
                            value2: d.date,
                          })}
                          onClick={() => selectTeam(t.id, d.date)}
                        >
                          <span>
                            {tr('safety_workspace.value1_scheduled', {
                              value1: d.scheduledWorkerCount,
                            })}
                          </span>
                          {d.workWindows.map((w, i) => (
                            <span className="block text-[10px]" key={i}>
                              {windowLabel(w.startsAt, w.endsAt)}
                            </span>
                          ))}
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
        <section
          aria-label={tr('safety_workspace.safety_teams')}
          className={'min-w-0 space-y-3 ' + (mobileDetail ? 'hidden lg:block' : '')}
        >
          {(mode === 'day' ? query.isPending : week.isPending) && (
            <p className={cardClass}>{tr('safety_workspace.loading_teams')}</p>
          )}
          {page && !page.items.length && (
            <p className={cardClass}>{tr('safety_workspace.no_teams_found_for_this_selection')}</p>
          )}
          {page?.items.map((t, i) => (
            <div key={t.id}>
              {(!i || page.items[i - 1]?.contractorId !== t.contractorId) && (
                <h3 className="mb-2 text-sm font-semibold text-[var(--text-secondary)]">
                  {t.contractorName}
                </h3>
              )}
              <button
                className={
                  cardClass +
                  ' w-full text-left ' +
                  (selectedId === t.id ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : '')
                }
                aria-current={selectedId === t.id ? 'true' : undefined}
                onClick={() => selectTeam(t.id)}
              >
                <strong className="block">{t.name}</strong>
                {'scheduledWorkerCount' in t ? (
                  <>
                    <p className="text-xs">
                      {tr('safety_workspace.value1_scheduled_value2_members', {
                        value1: t.scheduledWorkerCount,
                        value2: t.workerCount,
                      })}
                    </p>
                    {!t.scheduledWorkerCount && (
                      <p className="text-xs">
                        {tr('safety_workspace.no_planned_shift_for_this_date')}
                      </p>
                    )}
                    {t.workWindows?.map((w, i) => (
                      <p className="text-xs" key={i}>
                        {windowLabel(w.startsAt, w.endsAt)}
                      </p>
                    ))}
                    <p
                      className={
                        t.attentionAlertCount
                          ? 'text-sm font-semibold text-[var(--accent)]'
                          : 'text-xs'
                      }
                    >
                      {tr('safety_workspace.related_alerts_value1', {
                        value1: t.attentionAlertCount ?? tr('labels.UNAVAILABLE'),
                      })}
                    </p>
                    <ChecklistSummary value={t.checklistSummary} />
                  </>
                ) : (
                  <div className="text-xs">
                    <p>
                      {tr('safety_workspace.value1_scheduled', {
                        value1: t.days.find((d) => d.date === day)?.scheduledWorkerCount ?? 0,
                      })}
                    </p>
                    {t.days
                      .find((d) => d.date === day)
                      ?.workWindows.map((w, i) => (
                        <p key={i}>{windowLabel(w.startsAt, w.endsAt)}</p>
                      ))}
                    <p>
                      {tr('safety_workspace.related_alerts_value1', {
                        value1:
                          query.data?.teams.items.find((d) => d.id === t.id)?.attentionAlertCount ??
                          tr('labels.UNAVAILABLE'),
                      })}
                    </p>
                    <ChecklistSummary
                      value={query.data?.teams.items.find((d) => d.id === t.id)?.checklistSummary}
                    />
                  </div>
                )}
              </button>
            </div>
          ))}
          {page && (
            <Pager
              offset={offset}
              total={page.total}
              onChange={(next) => {
                setOffset(next);
                setSelected('');
                setWorkerOffset(0);
              }}
            />
          )}
          {!!query.data?.unassignedWorkers.total && (
            <section
              aria-label={tr('safety_workspace.workers_without_a_team')}
              className={cardClass}
            >
              <h3 className="text-sm font-bold">
                {tr('safety_workspace.workers_without_a_resolved_team_value1', {
                  value1: query.data.unassignedWorkers.total,
                })}
              </h3>
              {query.data.unassignedWorkers.items.map((w) => (
                <p className="text-xs" key={w.id + (w.startsAt ?? '')}>
                  {w.displayName} · {w.shiftName ?? tr('safety_workspace.no_recorded_shift')}
                </p>
              ))}
              <Pager
                total={query.data.unassignedWorkers.total}
                offset={unassignedOffset}
                onChange={setUnassignedOffset}
              />
            </section>
          )}
        </section>
        <section
          aria-label={tr('safety_workspace.safety_team_details')}
          className={'min-w-0 space-y-3 ' + (!mobileDetail ? 'hidden lg:block' : '')}
        >
          <button className={buttonClass + ' lg:hidden'} onClick={() => setMobileDetail(false)}>
            {tr('safety_workspace.back_to_teams')}
          </button>
          {detail.isPending && selectedId && (
            <p className={cardClass}>{tr('safety_workspace.loading_team_details')}</p>
          )}
          <RequestError error={detail.error} retry={() => void detail.refetch()} />
          {current && (
            <>
              <article className={cardClass}>
                <p className="text-xs text-[var(--text-secondary)]">
                  {current.contractorName} · {day}
                </p>
                <h3 className="text-lg font-bold">{current.name}</h3>
                <p className="text-sm">{current.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.canAlerts && (
                    <button className={buttonClass} onClick={() => alerts()}>
                      {tr('safety_workspace.view_related_alerts_value1', {
                        value1: current.attentionAlertCount ?? 0,
                      })}
                    </button>
                  )}
                  <button
                    className={buttonClass}
                    onClick={() => p.onViewChecklists(current.id, day, current.name)}
                  >
                    {tr('safety_workspace.view_checklists_for_this_date')}
                  </button>
                  {p.canAssign && (
                    <button
                      className={buttonClass}
                      disabled={!current.isActive || !current.zones.length}
                      onClick={() => p.onChecklist(current.id, day)}
                    >
                      {tr('safety_workspace.assign_checklist')}
                    </button>
                  )}
                </div>
              </article>
              <article className={cardClass}>
                <h3 className="font-bold">
                  {tr('safety_workspace.work_preparation_for_this_date')}
                </h3>

                {jobs.isPending && <p>{tr('safety_workspace.loading_work')}</p>}
                <RequestError error={jobs.error} retry={() => void jobs.refetch()} />
                {jobs.data?.items.map((job) => (
                  <div className="mt-2 border-t pt-2" key={job.id}>
                    <strong className="text-sm">{job.description}</strong>
                    <p className="text-xs">
                      {job.zoneName ?? tr('common.zone_unavailable')} ·{' '}
                      {windowLabel(job.startsAt, job.endsAt)} ·{' '}
                      {job.assignedToName ?? tr('common.account_unavailable')}
                    </p>
                    <p className="text-xs">
                      {job.status === 'ACCEPTED'
                        ? tr('safety_workspace.recorded')
                        : label(job.status)}
                    </p>
                  </div>
                ))}
                {jobs.data && !jobs.data.items.length && (
                  <p className="text-sm">
                    {tr('safety_workspace.no_checklist_assigned_for_this_date')}
                  </p>
                )}
                {jobs.data && jobs.data.total > 5 && (
                  <p className="text-xs">
                    {tr(
                      'safety_workspace.showing_5_of_value1_open_the_checklist_list_for_all_work',
                      { value1: jobs.data.total },
                    )}
                  </p>
                )}
              </article>
              <SafetyZoneContext
                key={current.id + day}
                {...p}
                detail={current}
                day={day}
                timezone={timezone}
                onAlerts={alerts}
              />
              <article className={cardClass}>
                <button
                  className="w-full text-left font-bold"
                  aria-expanded={workersOpen}
                  onClick={() => setWorkersOpen(!workersOpen)}
                >
                  {tr(
                    'safety_workspace.workers_and_planned_shifts_value1_scheduled_value2_members',
                    { value1: current.scheduledWorkerCount, value2: current.workerCount },
                  )}
                </button>
                {workersOpen && (
                  <>
                    <p className="text-xs">
                      {tr(
                        'safety_workspace.membership_is_resolved_at_shift_start_this_list_does_not_prove_attendance',
                      )}
                    </p>
                    {current.workers.items.map((w) => (
                      <div className="mt-2 border-t pt-2 text-sm" key={w.id + (w.startsAt ?? '')}>
                        <strong>{w.displayName}</strong>
                        <p className="text-xs">
                          {w.shiftName ?? tr('safety_workspace.no_recorded_shift')}
                          {w.startsAt && w.endsAt ? ' · ' + windowLabel(w.startsAt, w.endsAt) : ''}
                        </p>
                      </div>
                    ))}
                    <Pager
                      total={current.workers.total}
                      offset={workerOffset}
                      onChange={setWorkerOffset}
                    />
                  </>
                )}
              </article>
            </>
          )}
          {!selectedId && (
            <p className={cardClass}>
              {tr('safety_workspace.select_a_team_to_see_its_work_context')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
function windowLabel(startsAt: string, endsAt: string) {
  const start = new Date(startsAt),
    end = new Date(endsAt);
  const time = (d: Date) =>
    d.toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    time(start) +
    ' – ' +
    time(end) +
    (localDay(start) !== localDay(end)
      ? ' · ' + tr('safety_workspace.ends_value1', { value1: localDay(end) })
      : '')
  );
}

function ChecklistSummary({
  value,
}: {
  value?: import('@smartsite/api-client').SafetyChecklistSummary;
}) {
  useTranslation();

  if (!value)
    return (
      <p className="text-xs text-[var(--text-secondary)]">
        {tr('safety_workspace.checklist_summary_unavailable')}
      </p>
    );
  return (
    <div className="mt-2 space-y-1 text-xs" aria-label={tr('safety_workspace.checklist_summary')}>
      {value.noChecklistAssigned && (
        <p className="font-semibold text-[var(--accent)]">
          {tr('safety_workspace.no_checklist_assigned')}
        </p>
      )}
      {!value.total && !value.noChecklistAssigned && (
        <p>{tr('safety_workspace.no_checklist_for_this_date')}</p>
      )}
      {value.notSubmitted > 0 && (
        <p>{tr('safety_workspace.not_submitted_value1', { value1: value.notSubmitted })}</p>
      )}
      {value.needsUpdate > 0 && (
        <p className="font-semibold text-[var(--accent)]">
          {tr('safety_workspace.needs_update_value1', { value1: value.needsUpdate })}
        </p>
      )}
      {value.awaitingReview > 0 && (
        <p>{tr('safety_workspace.awaiting_review_value1', { value1: value.awaitingReview })}</p>
      )}
      {value.recordedWithFindings > 0 && (
        <p className="font-semibold text-[var(--accent)]">
          {tr('safety_workspace.recorded_with_findings_value1', {
            value1: value.recordedWithFindings,
          })}
        </p>
      )}
      {value.recordedWithoutFailures > 0 && (
        <p>
          {tr('safety_workspace.recorded_no_reported_failures_value1', {
            value1: value.recordedWithoutFailures,
          })}
        </p>
      )}
      {!!value.pastStartWithoutReport && (
        <p className="text-[var(--accent)]">
          {tr('safety_workspace.past_planned_start_no_report_value1', {
            value1: value.pastStartWithoutReport,
          })}
        </p>
      )}
      {!!value.lateFirstReports && (
        <p>
          {tr('safety_workspace.first_report_submitted_after_planned_start_value1', {
            value1: value.lateFirstReports,
          })}
        </p>
      )}
      {!!value.reviewPendingPastStart && (
        <p>
          {tr('safety_workspace.past_planned_start_awaiting_safety_value1', {
            value1: value.reviewPendingPastStart,
          })}
        </p>
      )}
      {!!value.findingsWithoutIncident && (
        <p>
          {tr('safety_workspace.findings_without_an_incident_value1', {
            value1: value.findingsWithoutIncident,
          })}
        </p>
      )}
      {!!value.openIncidentFindings && (
        <p>
          {tr('safety_workspace.incident_follow_up_open_value1', {
            value1: value.openIncidentFindings,
          })}
        </p>
      )}
      {!!value.closedIncidentFindings && (
        <p>
          {tr('safety_workspace.incident_follow_up_closed_value1', {
            value1: value.closedIncidentFindings,
          })}
        </p>
      )}
      {value.pastStartWithoutReport === undefined && value.pastPlannedStart > 0 && (
        <p className="font-semibold text-[var(--accent)]">
          {tr('safety_workspace.past_planned_start_needs_attention_value1', {
            value1: value.pastPlannedStart,
          })}
        </p>
      )}
    </div>
  );
}

function weekEnd(day: string) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + 6 - ((d.getDay() + 6) % 7));
  return localDay(d);
}
