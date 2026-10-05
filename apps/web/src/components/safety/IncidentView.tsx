import {
  type WorkflowProps,
  type WithoutCommandId,
  hasRole,
  text,
  ids,
  deadline,
  photo,
  date,
  label,
  fieldClass,
  buttonClass,
  primaryClass,
  cardClass,
  useWorkflowCommand,
} from './safety-workflow';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  CreateIncidentCommand,
  CorrectiveActionResponse,
  IncidentDetailResponse,
  IncidentSeverity,
  SafetyAlertDetailResponse,
  VersionCommand,
  ReasonCommand,
  LinkIncidentAlertsCommand,
  AssignCorrectiveActionCommand,
  SubmitSafetyResultCommand,
  ReviewSubmissionCommand,
  ReopenIncidentCommand,
} from '@smartsite/api-client';
import {
  ConfirmedAlerts,
  Assignee,
  Field,
  ResultFields,
  CommandForm,
  RequestError,
  Audit,
  Pager,
  Evidence,
  BlobImage,
  Dialog,
  StatusBadge,
  TechnicalDetails,
  OfficerName,
} from './SafetyWorkflowUi';
export interface IncidentViewProps extends WorkflowProps {
  initialAlertId?: string;
  onSourceConsumed?: () => void;
}
const statuses = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'VERIFIED', 'CLOSED', 'REOPENED'];
type Command =
  | VersionCommand
  | ReasonCommand
  | LinkIncidentAlertsCommand
  | AssignCorrectiveActionCommand
  | SubmitSafetyResultCommand
  | ReviewSubmissionCommand
  | ReopenIncidentCommand;
type Editor = {
  op: 'create' | 'link' | 'assign' | 'submit' | 'review' | 'close' | 'reopen';
  actionId?: string;
  submissionId?: string;
};
const titles = {
  create: 'New incident',
  link: 'Link alerts',
  assign: 'Assign corrective action',
  submit: 'Submit result',
  review: 'Review result',
  close: 'Close incident',
  reopen: 'Reopen incident',
};
export function IncidentView(p: IncidentViewProps) {
  const [occurredDefault] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  );
  const safety = hasRole(p, 'SAFETY_OFFICER'),
    security = hasRole(p, 'SECURITY_OFFICER');
  const [selected, setSelected] = useState(''),
    [status, setStatus] = useState(''),
    [assignedTo, setAssignedTo] = useState(''),
    [offset, setOffset] = useState(0),
    [mobileDetail, setMobileDetail] = useState(false),
    [editor, setEditor] = useState<Editor | undefined>(
      p.initialAlertId ? { op: 'create' } : undefined,
    );
  const mutation = useWorkflowCommand(p, (id) => {
    setSelected(id);
    setMobileDetail(true);
    setEditor(undefined);
    p.onSourceConsumed?.();
  });
  const list = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'incidents',
      status,
      assignedTo,
      offset,
    ],
    queryFn: ({ signal }) =>
      p.client.listIncidents(
        p.token,
        p.siteId,
        { offset, limit: 20, ...(status ? { status } : {}), ...(assignedTo ? { assignedTo } : {}) },
        { signal },
      ),
    retry: false,
  });
  const detail = useQuery({
    queryKey: ['safety-workflow', p.apiUrl, p.scope, p.siteId, 'incident', selected],
    queryFn: ({ signal }) => p.client.getIncident(p.token, p.siteId, selected, { signal }),
    enabled: !!selected,
    staleTime: 0,
    retry: false,
  });
  const reload = () => {
    mutation.reset();
    void list.refetch();
    if (selected) void detail.refetch();
  };
  const open = (next: Editor) => {
    mutation.reset();
    setEditor(next);
  };
  const command = (
    op: 'link' | 'assign' | 'start' | 'submit' | 'review' | 'close' | 'reopen',
    input: WithoutCommandId<Command>,
    actionId?: string,
    file?: File,
  ) => {
    if (!detail.data) return;
    const id = detail.data.id;
    mutation.mutate({
      fingerprint: JSON.stringify({ id, op, input, actionId }),
      file,
      run: (commandId, signal) =>
        p.client.incidentCommand(
          p.token,
          p.siteId,
          id,
          op,
          { ...input, commandId } as Command,
          actionId,
          file,
          { signal },
        ),
    });
  };
  const current = detail.data,
    action = current?.actions.find((a) => a.id === editor?.actionId);
  const ready =
    current &&
    current.actions.length > 0 &&
    current.actions.every((a) => a.status === 'VERIFIED' || a.status === 'CLOSED') &&
    !current.actions.some((a) => a.submissions.some((s) => s.status === 'PENDING'));
  const closeHint = !current?.actions.length
    ? 'Assign at least one corrective action before closing.'
    : !ready
      ? 'Verify every corrective action and review all pending results before closing.'
      : 'All corrective actions are verified. This incident can be closed.';
  return (
    <div className="space-y-5">
      <div
        className={
          (mobileDetail ? 'hidden lg:flex ' : 'flex ') +
          'flex-wrap items-start justify-between gap-3'
        }
      >
        <div>
          <h2 className="text-xl font-bold">
            {security && !safety ? 'My corrective work' : 'Incidents'}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {security && !safety
              ? 'Start your assigned work and submit results for Safety review.'
              : 'Manage corrective work from the first report to verified closure.'}
          </p>
        </div>
        {safety && (
          <button
            className={primaryClass}
            disabled={mutation.isPending}
            onClick={() => open({ op: 'create' })}
          >
            New incident
          </button>
        )}
      </div>
      {!editor && <RequestError error={mutation.error} retry={reload} />}
      {mutation.isSuccess && (
        <p
          role="status"
          className="rounded-lg bg-[var(--semantic-green-bg)] p-3 text-sm text-[var(--semantic-green-text)]"
        >
          Change recorded.
        </p>
      )}
      <div
        className={
          (mobileDetail ? 'hidden lg:flex ' : 'flex ') +
          'flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white p-4'
        }
      >
        <label className="text-sm font-semibold">
          Status
          <select
            className={fieldClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        {(safety ||
          p.user.roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null)) && (
          <Assignee
            p={p}
            role="SECURITY_OFFICER"
            value={assignedTo}
            onChange={(value) => {
              setAssignedTo(value);
              setOffset(0);
            }}
          />
        )}
        <button className={buttonClass} onClick={reload}>
          Refresh incidents
        </button>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
        <section
          aria-label="Incident list"
          className={'min-w-0 space-y-3 ' + (mobileDetail ? 'hidden lg:block' : '')}
        >
          {list.isPending && <p className={cardClass}>Loading incidents…</p>}
          <RequestError error={list.error} retry={() => void list.refetch()} />
          {list.data && !list.data.items.length && (
            <p className={cardClass + ' text-sm text-[var(--text-secondary)]'}>
              No incidents found.
            </p>
          )}
          {list.data?.items.map((item) => (
            <button
              key={item.id}
              className={
                cardClass +
                ' w-full text-left transition-colors hover:bg-[var(--surface-bone)] ' +
                (selected === item.id ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : '')
              }
              aria-current={selected === item.id ? 'true' : undefined}
              onClick={() => {
                setSelected(item.id);
                setMobileDetail(true);
                mutation.reset();
              }}
            >
              <strong className="block break-words text-base">{item.title}</strong>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={item.status} />
                <StatusBadge value={item.severity} />
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Occurred {date(item.occurredAt)}
              </p>
            </button>
          ))}
          {list.data && <Pager offset={offset} total={list.data.total} onChange={setOffset} />}
        </section>
        <section
          aria-label="Incident detail"
          className={'min-w-0 space-y-4 ' + (!mobileDetail ? 'hidden lg:block' : '')}
        >
          <button className={buttonClass + ' lg:hidden'} onClick={() => setMobileDetail(false)}>
            Back to incidents
          </button>
          {!selected && (
            <div className={cardClass + ' py-14 text-center'}>
              <h3 className="font-bold">Select an incident</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                View its source alerts, corrective actions and history here.
              </p>
            </div>
          )}
          {detail.isPending && selected && <p className={cardClass}>Loading incident…</p>}
          <RequestError error={detail.error} retry={() => void detail.refetch()} />
          {current && (
            <>
              <article className={cardClass}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h3 className="min-w-0 break-words text-xl font-bold">{current.title}</h3>
                  <div className="flex gap-2">
                    <StatusBadge value={current.status} />
                    <StatusBadge value={current.severity} />
                  </div>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-6">
                  {current.description}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Occurred {date(current.occurredAt)}
                  {current.closedAt && ' · Closed ' + date(current.closedAt)}
                </p>
                {safety && (
                  <div className="flex flex-wrap gap-2">
                    {current.status === 'CLOSED' ? (
                      <button
                        className={primaryClass}
                        disabled={mutation.isPending}
                        onClick={() => open({ op: 'reopen' })}
                      >
                        Reopen incident
                      </button>
                    ) : (
                      <>
                        <button
                          className={primaryClass}
                          disabled={mutation.isPending}
                          onClick={() => open({ op: 'assign' })}
                        >
                          Assign corrective action
                        </button>
                        <button
                          className={buttonClass}
                          disabled={mutation.isPending}
                          onClick={() => open({ op: 'link' })}
                        >
                          Link alerts
                        </button>
                        <button
                          className={buttonClass}
                          disabled={!ready || mutation.isPending}
                          title={closeHint}
                          onClick={() => open({ op: 'close' })}
                        >
                          Close incident
                        </button>
                      </>
                    )}
                  </div>
                )}
                {safety && current.status !== 'CLOSED' && (
                  <p className="rounded-lg bg-[var(--surface-bone)] p-3 text-sm text-[var(--text-secondary)]">
                    {closeHint}
                  </p>
                )}
                <TechnicalDetails>
                  <p>Incident {current.id}</p>
                  <p>Version {current.version}</p>
                  <p>Reported by {current.reportedBy}</p>
                  {current.zoneId && <p>Zone {current.zoneId}</p>}
                </TechnicalDetails>
              </article>
              <section className={cardClass}>
                <h3 className="font-bold">
                  Source alerts{' '}
                  <span className="text-[var(--text-secondary)]">({current.alerts.length})</span>
                </h3>
                {!current.alerts.length && (
                  <p className="text-sm text-[var(--text-secondary)]">
                    Manual incident; no source alert.
                  </p>
                )}
                {current.alerts.map((alert) => (
                  <SourceAlert key={alert.id} p={p} incidentId={current.id} alertId={alert.id} />
                ))}
              </section>
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold">Corrective actions ({current.actions.length})</h3>
                  <span className="text-xs text-[var(--text-secondary)]">
                    {
                      current.actions.filter((a) => ['VERIFIED', 'CLOSED'].includes(a.status))
                        .length
                    }{' '}
                    verified
                  </span>
                </div>
                {!current.actions.length && (
                  <p className={cardClass + ' text-sm text-[var(--text-secondary)]'}>
                    No corrective action assigned yet.
                  </p>
                )}
                {current.actions.map((a) => (
                  <Action
                    key={a.id}
                    p={p}
                    incident={current}
                    action={a}
                    pending={mutation.isPending}
                    checkedAt={detail.dataUpdatedAt}
                    command={command}
                    open={open}
                  />
                ))}
              </section>
              <Audit items={current.audit} />
            </>
          )}
        </section>
      </div>
      {editor && (
        <Dialog
          title={titles[editor.op]}
          pending={mutation.isPending}
          onClose={() => {
            setEditor(undefined);
            p.onSourceConsumed?.();
          }}
          error={mutation.error}
          reload={reload}
        >
          <CommandForm
            pending={mutation.isPending}
            label={
              editor.op === 'create'
                ? 'Create incident'
                : editor.op === 'review'
                  ? 'Record review'
                  : titles[editor.op]
            }
            onSubmit={(form) => {
              if (editor.op === 'create') {
                const input: Omit<CreateIncidentCommand, 'commandId'> = {
                  title: text(form, 'title'),
                  description: text(form, 'description'),
                  severity: text(form, 'severity') as IncidentSeverity,
                  occurredAt: new Date(text(form, 'occurredAt')).toISOString(),
                  zoneId: text(form, 'zoneId') || null,
                  alertIds: ids(form, 'alertIds'),
                };
                mutation.mutate({
                  fingerprint: JSON.stringify(input),
                  run: (commandId, signal) =>
                    p.client.createIncident(p.token, p.siteId, { ...input, commandId }, { signal }),
                });
                return;
              }
              if (!current) return;
              if (editor.op === 'link')
                command('link', {
                  expectedVersion: current.version,
                  alertIds: ids(form, 'alertIds'),
                } as LinkIncidentAlertsCommand);
              else if (editor.op === 'assign' || editor.op === 'reopen')
                command(editor.op, {
                  expectedVersion: current.version,
                  assignedTo: text(form, 'assignedTo'),
                  description: text(form, 'description'),
                  dueAt: deadline(form),
                  ...(editor.op === 'reopen' ? { reason: text(form, 'reason') } : {}),
                } as AssignCorrectiveActionCommand | ReopenIncidentCommand);
              else if (editor.op === 'close')
                command('close', {
                  expectedVersion: current.version,
                  reason: text(form, 'reason'),
                });
              else if (action && editor.op === 'submit')
                command(
                  'submit',
                  {
                    expectedVersion: action.version,
                    resultDescription: text(form, 'resultDescription'),
                  } as SubmitSafetyResultCommand,
                  action.id,
                  photo(form),
                );
              else if (action && editor.op === 'review')
                command(
                  'review',
                  {
                    expectedVersion: action.version,
                    submissionId: editor.submissionId!,
                    decision: text(form, 'decision') as 'APPROVED' | 'REJECTED',
                    reason: text(form, 'reason'),
                  } as ReviewSubmissionCommand,
                  action.id,
                );
            }}
          >
            {editor.op === 'create' && (
              <>
                <Field name="title" label="Title" required maxLength={200} />
                <Field name="description" label="Description" required type="textarea" />
                <label className="block text-sm font-semibold">
                  Severity
                  <select className={fieldClass} name="severity">
                    {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  name="occurredAt"
                  label="Occurred at (local time)"
                  type="datetime-local"
                  required
                  defaultValue={occurredDefault}
                />
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold">Optional references</summary>
                  <Field name="zoneId" label="Zone ID (optional)" />
                </details>
                <ConfirmedAlerts p={p} initialAlertId={p.initialAlertId} />
                <p className="text-xs text-[var(--text-secondary)]">
                  Select no alerts for a manual incident. Source evidence and review history stay
                  intact.
                </p>
              </>
            )}
            {editor.op === 'link' && <ConfirmedAlerts p={p} />}
            {(editor.op === 'assign' || editor.op === 'reopen') && (
              <>
                {editor.op === 'reopen' && (
                  <Field name="reason" label="Reopening reason" type="textarea" required />
                )}
                <Assignee p={p} role="SECURITY_OFFICER" />
                <Field name="description" label="Action description" type="textarea" required />
                <Field name="dueAt" label="Deadline (optional, local time)" type="datetime-local" />
              </>
            )}
            {editor.op === 'close' && (
              <>
                <Field name="reason" label="Closure reason" type="textarea" required />
                <p className="text-sm text-[var(--text-secondary)]">{closeHint}</p>
              </>
            )}
            {editor.op === 'submit' && <ResultFields />}
            {editor.op === 'review' && (
              <>
                <label className="block text-sm font-semibold">
                  Decision
                  <select name="decision" className={fieldClass}>
                    <option value="APPROVED">Approve</option>
                    <option value="REJECTED">Return for correction</option>
                  </select>
                </label>
                <Field name="reason" label="Review reason" type="textarea" required />
              </>
            )}
          </CommandForm>
        </Dialog>
      )}
    </div>
  );
}
function Action({
  p,
  incident,
  action,
  pending,
  checkedAt,
  command,
  open,
}: {
  p: WorkflowProps;
  incident: IncidentDetailResponse;
  action: CorrectiveActionResponse;
  pending: boolean;
  checkedAt: number;
  command: (op: 'start', input: WithoutCommandId<VersionCommand>, actionId: string) => void;
  open: (editor: Editor) => void;
}) {
  const mine = hasRole(p, 'SECURITY_OFFICER') && action.assignedTo === p.user.id;
  const waiting = action.submissions.filter((s) => s.status === 'PENDING'),
    history = action.submissions.filter((s) => s.status !== 'PENDING');
  const result = (submission: CorrectiveActionResponse['submissions'][number]) => (
    <section
      key={submission.id}
      className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-bone)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge value={submission.status} />
        <time className="text-xs text-[var(--text-secondary)]">
          Submitted {date(submission.submittedAt)}
        </time>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{submission.resultDescription}</p>
      {submission.reviewNote && (
        <p className="text-sm">
          Review: {submission.reviewNote} · {date(submission.reviewedAt)}
        </p>
      )}
      {submission.evidence && (
        <Evidence p={p} type="incidents" id={incident.id} evidenceId={submission.evidence.id} />
      )}
      {hasRole(p, 'SAFETY_OFFICER') &&
        submission.status === 'PENDING' &&
        submission.submittedBy !== p.user.id && (
          <button
            className={primaryClass}
            disabled={pending}
            onClick={() => open({ op: 'review', actionId: action.id, submissionId: submission.id })}
          >
            Review result
          </button>
        )}
    </section>
  );
  return (
    <article className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="min-w-0 break-words font-semibold">{action.description}</h4>
        <StatusBadge value={action.status} />
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        <OfficerName p={p} role="SECURITY_OFFICER" id={action.assignedTo} /> · Deadline{' '}
        {date(action.dueAt)}
      </p>
      {action.dueAt &&
        new Date(action.dueAt).getTime() < checkedAt &&
        !['CLOSED', 'VERIFIED'].includes(action.status) && (
          <p className="text-xs font-semibold text-[var(--semantic-red-text)]">Past deadline</p>
        )}
      {mine && action.status === 'ASSIGNED' && (
        <button
          className={primaryClass}
          disabled={pending}
          onClick={() => command('start', { expectedVersion: action.version }, action.id)}
        >
          Start action
        </button>
      )}
      {mine && action.status === 'IN_PROGRESS' && (
        <button
          className={primaryClass}
          disabled={pending}
          onClick={() => open({ op: 'submit', actionId: action.id })}
        >
          Submit result
        </button>
      )}
      {waiting.length > 0 && (
        <div className="space-y-3">
          <h5 className="text-sm font-bold">Awaiting Safety review</h5>
          {waiting.map(result)}
        </div>
      )}
      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            Submission history ({history.length})
          </summary>
          <div className="mt-3 space-y-3">{history.map(result)}</div>
        </details>
      )}
      <TechnicalDetails>
        <p>Action {action.id}</p>
        <p>Version {action.version}</p>
        <p>Assignee {action.assignedTo}</p>
      </TechnicalDetails>
    </article>
  );
}

function SourceAlert({
  p,
  incidentId,
  alertId,
}: {
  p: WorkflowProps;
  incidentId: string;
  alertId: string;
}) {
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'incident-alert',
      incidentId,
      alertId,
    ],
    queryFn: ({ signal }) =>
      p.client.getIncidentAlert(p.token, p.siteId, incidentId, alertId, { signal }),
    enabled: open,
    retry: false,
  });
  return (
    <section className="space-y-2">
      <button className={buttonClass} onClick={() => setOpen(!open)}>
        Source alert {alertId.slice(0, 8)}
      </button>
      {open && (
        <>
          <RequestError error={query.error} retry={() => void query.refetch()} />
          {query.isPending && <p>Loading source evidence…</p>}
          {query.data && (
            <>
              <p>
                {label(query.data.alertType)} · {label(query.data.status)} ·{' '}
                {query.data.detectionCount} observations
              </p>
              <p>Candidate reference {query.data.candidateWorkerId ?? 'unknown'} (unverified)</p>
              {query.data.detections.map((d) =>
                d.evidence.map((e) => (
                  <CameraPhoto
                    key={d.eventId + ':' + e.index}
                    p={p}
                    incidentId={incidentId}
                    alert={query.data!}
                    eventId={d.eventId}
                    index={e.index}
                  />
                )),
              )}
              {query.data.reviews.map((r) => (
                <p key={r.id}>
                  {label(r.toStatus)}: {r.reason} · {date(r.createdAt)}
                </p>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
function CameraPhoto({
  p,
  incidentId,
  alert,
  eventId,
  index,
}: {
  p: WorkflowProps;
  incidentId: string;
  alert: SafetyAlertDetailResponse;
  eventId: string;
  index: number;
}) {
  const query = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'camera-evidence',
      incidentId,
      alert.id,
      eventId,
      index,
    ],
    queryFn: ({ signal }) =>
      p.client.getIncidentAlertEvidence(p.token, p.siteId, incidentId, alert.id, eventId, index, {
        signal,
      }),
    retry: false,
  });
  return (
    <>
      <RequestError error={query.error} retry={() => void query.refetch()} />
      {query.data && <BlobImage blob={query.data} alt="Original camera observation" />}
    </>
  );
}
