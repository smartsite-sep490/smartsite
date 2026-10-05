import {
  type WorkflowProps,
  type WithoutCommandId,
  hasRole,
  text,
  deadline,
  photo,
  date,
  label,
  fieldClass,
  buttonClass,
  primaryClass,
  dangerClass,
  cardClass,
  useWorkflowCommand,
} from './safety-workflow';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  CreateSafetyTaskCommand,
  SafetyTaskKind,
  VersionCommand,
  ReasonCommand,
  SubmitSafetyResultCommand,
} from '@smartsite/api-client';
import {
  Assignee,
  Field,
  ResultFields,
  CommandForm,
  RequestError,
  Audit,
  Pager,
  Evidence,
  Dialog,
  StatusBadge,
  TechnicalDetails,
  OfficerName,
} from './SafetyWorkflowUi';
const statuses = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED'];
type Editor = 'create' | 'submit' | 'review' | 'cancel';
const titles = {
  create: 'New safety task',
  submit: 'Submit task result',
  review: 'Review task',
  cancel: 'Cancel task',
};
export function SafetyTasksView(p: WorkflowProps) {
  const manager = hasRole(p, 'SITE_MANAGER');
  const [selected, setSelected] = useState(''),
    [status, setStatus] = useState(''),
    [assignedTo, setAssignedTo] = useState(''),
    [offset, setOffset] = useState(0),
    [mobileDetail, setMobileDetail] = useState(false),
    [editor, setEditor] = useState<Editor>();
  const mutation = useWorkflowCommand(p, (id) => {
    setSelected(id);
    setMobileDetail(true);
    setEditor(undefined);
  });
  const list = useQuery({
    queryKey: ['safety-workflow', p.apiUrl, p.scope, p.siteId, 'tasks', status, assignedTo, offset],
    queryFn: ({ signal }) =>
      p.client.listSafetyTasks(
        p.token,
        p.siteId,
        { offset, limit: 20, ...(status ? { status } : {}), ...(assignedTo ? { assignedTo } : {}) },
        { signal },
      ),
    retry: false,
  });
  const detail = useQuery({
    queryKey: ['safety-workflow', p.apiUrl, p.scope, p.siteId, 'task', selected],
    queryFn: ({ signal }) => p.client.getSafetyTask(p.token, p.siteId, selected, { signal }),
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
    op: 'start' | 'submit' | 'verify' | 'return' | 'cancel',
    input: WithoutCommandId<VersionCommand | ReasonCommand | SubmitSafetyResultCommand>,
    file?: File,
  ) => {
    if (!detail.data) return;
    const id = detail.data.id;
    mutation.mutate({
      fingerprint: JSON.stringify({ id, op, input }),
      file,
      run: (commandId, signal) =>
        p.client.safetyTaskCommand(p.token, p.siteId, id, op, { ...input, commandId }, file, {
          signal,
        }),
    });
  };
  const current = detail.data,
    mine = current?.assignedTo === p.user.id && hasRole(p, 'SAFETY_OFFICER');
  return (
    <div className="space-y-5">
      <div
        className={
          (mobileDetail ? 'hidden lg:flex ' : 'flex ') +
          'flex-wrap items-start justify-between gap-3'
        }
      >
        <div>
          <h2 className="text-xl font-bold">Safety Tasks</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {manager
              ? 'Assign site safety work and verify the reported results.'
              : 'Complete your assigned safety work and report results to the Site Manager.'}
          </p>
        </div>
        {manager && (
          <button
            className={primaryClass}
            disabled={mutation.isPending}
            onClick={() => open('create')}
          >
            New safety task
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
        {manager && (
          <Assignee
            p={p}
            role="SAFETY_OFFICER"
            value={assignedTo}
            onChange={(value) => {
              setAssignedTo(value);
              setOffset(0);
            }}
          />
        )}
        <button className={buttonClass} onClick={reload}>
          Refresh tasks
        </button>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
        <section
          aria-label="Safety task list"
          className={'min-w-0 space-y-3 ' + (mobileDetail ? 'hidden lg:block' : '')}
        >
          {list.isPending && <p className={cardClass}>Loading tasks…</p>}
          <RequestError error={list.error} retry={() => void list.refetch()} />
          {list.data && !list.data.items.length && (
            <p className={cardClass + ' text-sm text-[var(--text-secondary)]'}>
              No safety tasks found.
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
              <p className="text-xs font-semibold text-[var(--text-secondary)]">
                {label(item.kind)}
              </p>
              <strong className="block break-words">{item.description}</strong>
              <StatusBadge value={item.status} />
              <p className="text-xs text-[var(--text-secondary)]">Deadline {date(item.dueAt)}</p>
            </button>
          ))}
          {list.data && <Pager offset={offset} total={list.data.total} onChange={setOffset} />}
        </section>
        <section
          aria-label="Safety task detail"
          className={'min-w-0 space-y-4 ' + (!mobileDetail ? 'hidden lg:block' : '')}
        >
          <button className={buttonClass + ' lg:hidden'} onClick={() => setMobileDetail(false)}>
            Back to tasks
          </button>
          {!selected && (
            <div className={cardClass + ' py-14 text-center'}>
              <h3 className="font-bold">Select a safety task</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                View its progress, result and activity here.
              </p>
            </div>
          )}
          {selected && detail.isPending && <p className={cardClass}>Loading task…</p>}
          <RequestError error={detail.error} retry={() => void detail.refetch()} />
          {current && (
            <>
              <article className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--text-secondary)]">
                    {label(current.kind)}
                  </p>
                  <StatusBadge value={current.status} />
                </div>
                <h3 className="break-words text-xl font-bold">{current.description}</h3>
                <p className="text-sm text-[var(--text-secondary)]">
                  <OfficerName p={p} role="SAFETY_OFFICER" id={current.assignedTo} /> · Deadline{' '}
                  {date(current.dueAt)}
                </p>
                {current.dueAt &&
                  new Date(current.dueAt).getTime() < detail.dataUpdatedAt &&
                  !['VERIFIED', 'CANCELLED'].includes(current.status) && (
                    <p className="text-sm font-semibold text-[var(--semantic-red-text)]">
                      Past deadline
                    </p>
                  )}
                <div className="flex flex-wrap gap-2">
                  {mine && current.status === 'ASSIGNED' && (
                    <button
                      className={primaryClass}
                      disabled={mutation.isPending}
                      onClick={() => command('start', { expectedVersion: current.version })}
                    >
                      Start task
                    </button>
                  )}
                  {mine && current.status === 'IN_PROGRESS' && (
                    <button
                      className={primaryClass}
                      disabled={mutation.isPending}
                      onClick={() => open('submit')}
                    >
                      Submit task result
                    </button>
                  )}
                  {manager &&
                    current.status === 'COMPLETED' &&
                    current.assignedTo !== p.user.id && (
                      <button
                        className={primaryClass}
                        disabled={mutation.isPending}
                        onClick={() => open('review')}
                      >
                        Review task
                      </button>
                    )}
                  {manager && !['VERIFIED', 'CANCELLED'].includes(current.status) && (
                    <button
                      className={dangerClass}
                      disabled={mutation.isPending}
                      onClick={() => open('cancel')}
                    >
                      Cancel task
                    </button>
                  )}
                </div>
                {current.status === 'COMPLETED' && (
                  <p className="rounded-lg bg-[var(--semantic-blue-bg)] p-3 text-sm text-[var(--semantic-blue-text)]">
                    Awaiting Site Manager verification.
                  </p>
                )}
                <TechnicalDetails>
                  <p>Task {current.id}</p>
                  <p>Version {current.version}</p>
                  <p>Assignee {current.assignedTo}</p>
                  {current.zoneId && <p>Zone {current.zoneId}</p>}
                  {current.sourceAlertId && <p>Source Alert {current.sourceAlertId}</p>}
                  {current.sourceIncidentId && <p>Source Incident {current.sourceIncidentId}</p>}
                </TechnicalDetails>
              </article>
              <section className={cardClass}>
                <h3 className="font-bold">Current result</h3>
                {current.resultSummary ? (
                  <>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {current.resultSummary}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Submitted {date(current.completedAt)}
                    </p>
                    {current.resultEvidence && (
                      <Evidence
                        p={p}
                        type="safety-tasks"
                        id={current.id}
                        evidenceId={current.resultEvidence.id}
                      />
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[var(--text-secondary)]">No result submitted yet.</p>
                )}
              </section>
              <Audit items={current.audit} />
            </>
          )}
        </section>
      </div>
      {editor && (
        <Dialog
          title={titles[editor]}
          pending={mutation.isPending}
          onClose={() => setEditor(undefined)}
          error={mutation.error}
          reload={reload}
        >
          <CommandForm
            pending={mutation.isPending}
            label={
              editor === 'create'
                ? 'Create task'
                : editor === 'review'
                  ? 'Record task review'
                  : titles[editor]
            }
            onSubmit={(form) => {
              if (editor === 'create') {
                const input: Omit<CreateSafetyTaskCommand, 'commandId'> = {
                  kind: text(form, 'kind') as SafetyTaskKind,
                  assignedTo: text(form, 'assignedTo'),
                  description: text(form, 'description'),
                  dueAt: deadline(form),
                  zoneId: text(form, 'zoneId') || null,
                  sourceAlertId: text(form, 'sourceAlertId') || null,
                  sourceIncidentId: text(form, 'sourceIncidentId') || null,
                };
                mutation.mutate({
                  fingerprint: JSON.stringify(input),
                  run: (commandId, signal) =>
                    p.client.createSafetyTask(
                      p.token,
                      p.siteId,
                      { ...input, commandId },
                      { signal },
                    ),
                });
                return;
              }
              if (!current) return;
              if (editor === 'submit')
                command(
                  'submit',
                  {
                    expectedVersion: current.version,
                    resultDescription: text(form, 'resultDescription'),
                  } as SubmitSafetyResultCommand,
                  photo(form),
                );
              else
                command(
                  editor === 'review' ? (text(form, 'decision') as 'verify' | 'return') : 'cancel',
                  {
                    expectedVersion: current.version,
                    reason: text(form, 'reason'),
                  } as ReasonCommand,
                );
            }}
          >
            {editor === 'create' && (
              <>
                <label className="block text-sm font-semibold">
                  Task kind
                  <select name="kind" className={fieldClass}>
                    {[
                      'ZONE_INSPECTION',
                      'ALERT_VERIFICATION',
                      'SAFETY_FOLLOW_UP',
                      'SAFETY_PATROL',
                    ].map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <Assignee p={p} role="SAFETY_OFFICER" />
                <Field name="description" label="Task description" type="textarea" required />
                <Field name="dueAt" label="Deadline (optional, local time)" type="datetime-local" />
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold">Optional references</summary>
                  <div className="mt-3 space-y-3">
                    <Field name="zoneId" label="Zone ID (optional)" />
                    <Field name="sourceAlertId" label="Source Alert ID (optional)" />
                    <Field name="sourceIncidentId" label="Source Incident ID (optional)" />
                  </div>
                </details>
              </>
            )}
            {editor === 'submit' && <ResultFields />}
            {editor === 'review' && (
              <>
                <label className="block text-sm font-semibold">
                  Decision
                  <select name="decision" className={fieldClass}>
                    <option value="verify">Verify</option>
                    <option value="return">Return for correction</option>
                  </select>
                </label>
                <Field name="reason" label="Task review reason" type="textarea" required />
                <p className="text-xs text-[var(--text-secondary)]">
                  Returning a task keeps its earlier result in the activity history.
                </p>
              </>
            )}
            {editor === 'cancel' && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  Cancel this task? Its recorded results and history will be retained.
                </p>
                <Field name="reason" label="Cancellation reason" type="textarea" required />
              </>
            )}
          </CommandForm>
        </Dialog>
      )}
    </div>
  );
}
