import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type WorkflowProps, fieldClass, cardClass, buttonClass, date } from './safety-workflow';
import { RequestError, Pager, StatusBadge } from './SafetyWorkflowUi';
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
  const [day, setDay] = useState(localDay),
    [contractorId, setContractor] = useState(''),
    [teamFilter, setTeamFilter] = useState(''),
    [selected, setSelected] = useState(''),
    [offset, setOffset] = useState(0),
    [unassignedOffset, setUnassignedOffset] = useState(0),
    [workerOffset, setWorkerOffset] = useState(0),
    [mobileDetail, setMobileDetail] = useState(false);
  const timezone = browserTimezone(),
    base = ['safety-workflow', p.apiUrl, p.scope, p.siteId] as const;
  const contractors = useQuery({
    queryKey: [...base, 'overview-contractor-options', day, timezone],
    queryFn: ({ signal }) => overviewContractors(p, day, timezone, signal),
    enabled: p.active,
    retry: false,
  });
  const options = useQuery({
    queryKey: [...base, 'team-options', day, timezone, contractorId],
    queryFn: ({ signal }) => safetyTeams(p, day, timezone, contractorId, signal),
    enabled: p.active && !!day,
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
          unassignedOffset,
          unassignedLimit: 20,
          limit: 20,
        },
        { signal },
      ),
    enabled: p.active && !!day,
    refetchInterval: p.active ? 30000 : false,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const selectedId = selected || query.data?.teams.items[0]?.id || '';
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
    enabled: p.active && !!selectedId && !!day,
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
  };
  const alerts = (zoneId?: string, cameraExternalId?: string) =>
    p.onAlerts({
      contextTeamId: selectedId,
      attentionOnly: true,
      zoneId,
      cameraExternalId,
      ...dayWindow(day),
      caption:
        (detail.data?.contractorName ?? 'Contractor') +
        ' · ' +
        (detail.data?.name ?? 'Group') +
        ' · ' +
        day,
    });
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Safety overview</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Contractors, teams, planned shifts, recorded Zone grants and linked cameras.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className={buttonClass}
          onClick={() => {
            void query.refetch();
            void options.refetch();
            void contractors.refetch();
            if (selectedId) void detail.refetch();
          }}
        >
          Refresh overview
        </button>
        <p className="text-xs text-[var(--text-secondary)]">
          {query.data?.updatedAt
            ? 'Updated ' + date(query.data.updatedAt)
            : 'Summary update time unavailable'}{' '}
          · Refreshes every 30 seconds while visible.
        </p>
      </div>
      <div className={cardClass + ' grid gap-3 sm:grid-cols-3'}>
        <label className="text-sm font-semibold">
          Work date
          <input
            className={fieldClass}
            type="date"
            required
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              reset();
            }}
          />
        </label>
        <label className="text-sm font-semibold">
          Contractor
          <select
            className={fieldClass}
            value={contractorId}
            onChange={(e) => {
              setContractor(e.target.value);
              setTeamFilter('');
              reset();
            }}
          >
            <option value="">All contractors</option>
            {contractors.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          Team
          <select
            className={fieldClass}
            value={teamFilter}
            onChange={(e) => {
              setTeamFilter(e.target.value);
              reset();
            }}
          >
            <option value="">All teams</option>
            {options.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.contractorName} · {t.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[var(--text-secondary)] sm:col-span-3">
          Timezone: {timezone}. Scheduled members are resolved at shift start. Other membership uses
          the current time or the end of the selected past day. Schedules are planned work; grants
          and current camera links do not prove presence.
        </p>
        <RequestError error={contractors.error} retry={() => void contractors.refetch()} />
        <RequestError error={options.error} retry={() => void options.refetch()} />
      </div>
      <RequestError error={query.error} retry={() => void query.refetch()} />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
        <section
          aria-label="Safety teams"
          className={'min-w-0 space-y-3 ' + (mobileDetail ? 'hidden lg:block' : '')}
        >
          {query.isPending && p.active && <p className={cardClass}>Loading teams…</p>}
          {query.data && !query.data.teams.items.length && (
            <p className={cardClass}>No teams found for this date and filters.</p>
          )}
          {query.data?.teams.items.map((t) => (
            <button
              type="button"
              key={t.id}
              aria-current={selectedId === t.id ? 'true' : undefined}
              className={
                cardClass +
                ' w-full text-left ' +
                (selectedId === t.id ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : '') +
                (t.attentionAlertCount ? ' bg-[var(--semantic-red-bg)]' : '')
              }
              onClick={() => {
                setSelected(t.id);
                setWorkerOffset(0);
                setMobileDetail(true);
              }}
            >
              <p className="text-xs font-semibold text-[var(--text-secondary)]">
                {t.contractorName}
              </p>
              <strong className="block break-words text-base">{t.name}</strong>
              <p className="text-sm">
                {t.scheduledWorkerCount} scheduled · {t.workerCount} members
              </p>
              <p className="text-sm font-semibold">
                Related alerts: {t.attentionAlertCount ?? 'Unavailable'}
              </p>
              <ChecklistSummary value={t.checklistSummary} />
              {!t.isActive && <StatusBadge value="CANCELLED" text="Currently archived" />}
              {!t.scheduledWorkerCount && (
                <p className="text-xs text-[var(--text-secondary)]">
                  No recorded shift for this date.
                </p>
              )}
            </button>
          ))}
          <Pager offset={offset} total={query.data?.teams.total ?? 0} onChange={setOffset} />
          {!!query.data?.unassignedWorkers.total && (
            <section aria-label="Workers without a team" className={cardClass}>
              <h3 className="font-semibold">
                Workers without a resolved team ({query.data.unassignedWorkers.total})
              </h3>
              <p className="text-xs text-[var(--text-secondary)]">
                No membership was found at the reference time. Verify team context before assigning
                responsibility.
              </p>
              {query.data.unassignedWorkers.items.map((w) => (
                <p key={w.id + (w.startsAt ?? '')} className="text-sm">
                  {w.displayName} · {w.shiftName ?? 'No recorded shift'}
                </p>
              ))}
              <Pager
                offset={unassignedOffset}
                total={query.data.unassignedWorkers.total}
                onChange={setUnassignedOffset}
              />
            </section>
          )}
        </section>
        <section
          aria-label="Safety team details"
          className={'min-w-0 space-y-4 ' + (!mobileDetail ? 'hidden lg:block' : '')}
        >
          <button className={buttonClass + ' lg:hidden'} onClick={() => setMobileDetail(false)}>
            Back to teams
          </button>
          {detail.isPending && selectedId && p.active && (
            <p className={cardClass}>Loading team details…</p>
          )}
          <RequestError error={detail.error} retry={() => void detail.refetch()} />
          {detail.data && (
            <>
              <article className={cardClass}>
                <p className="text-sm text-[var(--text-secondary)]">{detail.data.contractorName}</p>
                <h3 className="text-xl font-bold">{detail.data.name}</h3>
                {detail.data.description && (
                  <p className="whitespace-pre-wrap text-sm">{detail.data.description}</p>
                )}
                <p className="text-sm">
                  {detail.data.scheduledWorkerCount} scheduled workers · {detail.data.workerCount}{' '}
                  members
                </p>
                <ChecklistSummary value={detail.data.checklistSummary} />
                <div className="my-3 flex flex-wrap gap-2">
                  {p.canAlerts && (
                    <button className={buttonClass} onClick={() => alerts()}>
                      View related alerts ({detail.data.attentionAlertCount ?? 0})
                    </button>
                  )}
                  <button
                    className={buttonClass}
                    onClick={() => p.onViewChecklists(detail.data!.id, day, detail.data!.name)}
                  >
                    View checklists for this date
                  </button>
                </div>
                {p.canAssign && (
                  <button
                    className={buttonClass}
                    disabled={!detail.data.isActive || !detail.data.zones.length}
                    onClick={() => p.onChecklist(detail.data!.id, day)}
                  >
                    Assign checklist
                  </button>
                )}
              </article>
              <article className={cardClass}>
                <h3 className="font-bold">Workers and planned shifts</h3>
                {!detail.data.workers.items.length && (
                  <p className="text-sm text-[var(--text-secondary)]">
                    No Worker membership available at the reference time.
                  </p>
                )}
                {detail.data.workers.items.map((w) => (
                  <div
                    key={w.id + (w.startsAt ?? '')}
                    className="border-b border-[var(--border)] pb-3 last:border-0"
                  >
                    <strong className="break-words text-sm">{w.displayName}</strong>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {w.shiftName
                        ? w.shiftName + ' · ' + date(w.startsAt) + ' – ' + date(w.endsAt)
                        : 'No recorded shift'}
                      {!w.isActive ? ' · Currently inactive' : ''}
                    </p>
                  </div>
                ))}
                <Pager
                  offset={workerOffset}
                  total={detail.data.workers.total}
                  onChange={setWorkerOffset}
                />
              </article>
              <article className={cardClass}>
                <h3 className="font-bold">Zone grants and current cameras</h3>
                {!detail.data.zones.length && (
                  <p className="text-sm text-[var(--text-secondary)]">
                    No applicable recorded Zone grant. Coordinate Zone setup with the Site Manager.
                  </p>
                )}
                {detail.data.zones.map((z) => (
                  <div
                    key={z.id + z.validFrom}
                    className="space-y-3 rounded-lg bg-[var(--surface-bone)] p-3"
                  >
                    <strong className="text-sm">
                      {z.name} · {z.code} · Related alerts: {z.attentionAlertCount ?? 'Unavailable'}
                    </strong>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {date(z.validFrom)} – {date(z.validUntil)}
                    </p>
                    {p.canAlerts && (
                      <button className={buttonClass} onClick={() => alerts(z.id)}>
                        View Zone alerts
                      </button>
                    )}
                    {!detail.data!.cameras.some((c) => c.zoneId === z.id) && (
                      <p className="text-sm text-[var(--text-secondary)]">
                        No current camera linked to this Zone.
                      </p>
                    )}
                    {detail
                      .data!.cameras.filter((c) => c.zoneId === z.id)
                      .map((c) => (
                        <div
                          key={c.id}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <p className="text-sm">
                            {c.name} · {c.code} <StatusBadge value={c.status} /> · Related alerts:{' '}
                            {c.attentionAlertCount ?? 'Unavailable'}
                          </p>
                          {p.canAlerts && (
                            <button
                              className={buttonClass}
                              onClick={() => alerts(z.id, c.externalId)}
                            >
                              View camera alerts
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
                ))}
              </article>
            </>
          )}
          {!selectedId && <p className={cardClass}>Select a team to see its work context.</p>}
        </section>
      </div>
    </div>
  );
}

function ChecklistSummary({
  value,
}: {
  value?: import('@smartsite/api-client').SafetyChecklistSummary;
}) {
  if (!value)
    return <p className="text-xs text-[var(--text-secondary)]">Checklist summary unavailable.</p>;
  return (
    <div className="mt-2 space-y-1 text-xs" aria-label="Checklist summary">
      {value.noChecklistAssigned && (
        <p className="font-semibold text-[var(--accent)]">No checklist assigned</p>
      )}
      {!value.total && !value.noChecklistAssigned && <p>No checklist for this date.</p>}
      {value.notSubmitted > 0 && <p>Not submitted: {value.notSubmitted}</p>}
      {value.needsUpdate > 0 && (
        <p className="font-semibold text-[var(--accent)]">Needs update: {value.needsUpdate}</p>
      )}
      {value.awaitingReview > 0 && <p>Awaiting review: {value.awaitingReview}</p>}
      {value.recordedWithFindings > 0 && (
        <p className="font-semibold text-[var(--accent)]">
          Recorded with findings: {value.recordedWithFindings}
        </p>
      )}
      {value.recordedWithoutFailures > 0 && (
        <p>Recorded, no reported failures: {value.recordedWithoutFailures}</p>
      )}
      {value.pastPlannedStart > 0 && (
        <p className="font-semibold text-[var(--accent)]">
          Past planned start — needs attention: {value.pastPlannedStart}
        </p>
      )}
    </div>
  );
}
