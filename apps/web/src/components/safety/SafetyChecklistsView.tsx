import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ChecklistResultResponse,
  ChecklistSubmissionResponse,
  ChecklistDetailResponse,
  IncidentSeverity,
  CreateIncidentCommand,
  CreateChecklistCommand,
} from '@smartsite/api-client';
import {
  type WorkflowProps,
  hasRole,
  cardClass,
  buttonClass,
  primaryClass,
  dangerClass,
  fieldClass,
  date,
  useWorkflowCommand,
} from './safety-workflow';
import {
  Assignee,
  Audit,
  CommandForm,
  Dialog,
  Field,
  Pager,
  RequestError,
  StatusBadge,
  TechnicalDetails,
} from './SafetyWorkflowUi';
import { CreateChecklistForm, ReportChecklistForm } from './ChecklistForms';
import { ChecklistEvidence } from './ChecklistEvidence';
import { localInput } from './safety-context';
const statuses = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'ACCEPTED', 'CANCELLED'];
type Editor = {
  op: 'create' | 'submit' | 'record' | 'return' | 'cancel' | 'incident';
  version: number;
  result?: ChecklistResultResponse;
  submission?: ChecklistSubmissionResponse;
};
export function SafetyChecklistsView(
  p: WorkflowProps & {
    active: boolean;
    context?: import('./safety-context').RelatedChecklistFilter;
    onClearContext?: () => void;
    onBackToOverview?: () => void;
    initialChecklistId?: string;
    draft?: { teamId: string; day: string };
    onDraftConsumed: () => void;
    onIncident: (id: string) => void;
  },
) {
  const safety = hasRole(p, 'SAFETY_OFFICER'),
    representative = hasRole(p, 'CONTRACTOR_REPRESENTATIVE');
  const [status, setStatus] = useState(''),
    [assignedTo, setAssignedTo] = useState(''),
    [selected, setSelected] = useState(p.initialChecklistId ?? ''),
    [offset, setOffset] = useState(0),
    [mobileDetail, setMobileDetail] = useState(!!p.initialChecklistId),
    [editor, setEditor] = useState<Editor | null>(p.draft ? { op: 'create', version: 0 } : null),
    [draft, setDraft] = useState(p.draft),
    [previousDraft, setPreviousDraft] = useState(p.draft),
    [previousId, setPreviousId] = useState(p.initialChecklistId),
    [previousContext, setPreviousContext] = useState(p.context);
  if (previousContext !== p.context) {
    setPreviousContext(p.context);
    setSelected('');
    setOffset(0);
    setStatus('');
    setAssignedTo('');
    setMobileDetail(false);
  }
  if (previousId !== p.initialChecklistId) {
    setPreviousId(p.initialChecklistId);
    if (p.initialChecklistId) {
      setSelected(p.initialChecklistId);
      setMobileDetail(true);
    }
  }
  if (previousDraft !== p.draft) {
    setPreviousDraft(p.draft);
    if (p.draft) {
      setDraft(p.draft);
      setEditor({ op: 'create', version: 0 });
    }
  }
  const base = ['safety-workflow', p.apiUrl, p.scope, p.siteId] as const;
  const list = useQuery({
    queryKey: [...base, 'checklists', status, assignedTo, offset, p.context],
    queryFn: ({ signal }) =>
      p.client.listSafetyChecklists(
        p.token,
        p.siteId,
        {
          offset,
          limit: 20,
          status: status || undefined,
          assignedTo: assignedTo || undefined,
          teamId: p.context?.teamId,
          fromDate: p.context?.fromDate,
          toDate: p.context?.toDate,
          timezone: p.context?.timezone,
        },
        { signal },
      ),
    enabled: p.active,
    retry: false,
  });
  const selectedId = selected || list.data?.items[0]?.id || '';
  const detail = useQuery({
    queryKey: [...base, 'checklist', selectedId],
    queryFn: ({ signal }) => p.client.getSafetyChecklist(p.token, p.siteId, selectedId, { signal }),
    enabled: p.active && !!selectedId,
    retry: false,
  });
  const close = () => {
    setEditor(null);
    p.onDraftConsumed();
  };
  const mutation = useWorkflowCommand(p, (id) => {
    if (editor?.op === 'incident') p.onIncident(id);
    else setSelected(id);
    setMobileDetail(true);
    close();
  });
  const reload = () => {
    mutation.reset();
    close();
    void list.refetch();
    if (selectedId) void detail.refetch();
  };
  const current = detail.data,
    pending = current?.submissions.find((s) => s.status === 'PENDING');
  const open = (next: Editor) => {
    mutation.reset();
    setEditor(next);
  };
  return (
    <div className="space-y-5">
      {p.context && (
        <div className={cardClass}>
          <p>Checklists: {p.context.caption}</p>
          <div className="mt-2 flex gap-3">
            <button className={buttonClass} onClick={p.onBackToOverview}>
              Back to overview
            </button>
            <button className={buttonClass} onClick={p.onClearContext}>
              Clear context filter
            </button>
          </div>
        </div>
      )}
      <div
        className={
          (mobileDetail ? 'hidden lg:flex ' : 'flex ') +
          'flex-wrap items-start justify-between gap-3'
        }
      >
        <div>
          <h2 className="text-xl font-bold">
            {representative && !safety ? 'My checklists' : 'Safety checklists'}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Prepare evidence for the work, report each criterion and keep the feedback history.
          </p>
        </div>
        {safety && (
          <button
            className={primaryClass}
            onClick={() => {
              setDraft(undefined);
              open({ op: 'create', version: 0 });
            }}
          >
            New checklist
          </button>
        )}
      </div>
      {!editor && <RequestError error={mutation.error} retry={reload} />}
      {mutation.isSuccess && (
        <p role="status" className="rounded-lg bg-[var(--semantic-green-bg)] p-3 text-sm">
          Change recorded.
        </p>
      )}
      <div
        className={
          (mobileDetail ? 'hidden lg:flex ' : 'flex ') + cardClass + ' flex-wrap items-end gap-3'
        }
      >
        <label className="text-sm font-semibold">
          Status
          <select
            className={fieldClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setSelected('');
              setOffset(0);
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s === 'ACCEPTED' ? 'Recorded' : s.toLowerCase().replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {(safety ||
          p.user.roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null)) && (
          <Assignee
            p={p}
            role="CONTRACTOR_REPRESENTATIVE"
            value={assignedTo}
            onChange={(value) => {
              setAssignedTo(value);
              setSelected('');
              setOffset(0);
            }}
          />
        )}
        <button className={buttonClass} onClick={reload}>
          Refresh checklists
        </button>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
        <section
          aria-label="Checklist list"
          className={'min-w-0 space-y-3 ' + (mobileDetail ? 'hidden lg:block' : '')}
        >
          {list.isPending && p.active && <p className={cardClass}>Loading checklists…</p>}
          <RequestError error={list.error} retry={() => void list.refetch()} />
          {list.data && !list.data.items.length && (
            <p className={cardClass}>No checklists found.</p>
          )}
          {list.data?.items.map((a) => (
            <button
              type="button"
              key={a.id}
              aria-current={selectedId === a.id ? 'true' : undefined}
              className={
                cardClass +
                ' w-full text-left ' +
                (selectedId === a.id ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : '')
              }
              onClick={() => {
                setSelected(a.id);
                setMobileDetail(true);
                mutation.reset();
              }}
            >
              <p className="text-xs font-semibold text-[var(--text-secondary)]">
                {a.contractorName ?? 'Contractor unavailable'} · {a.teamName ?? 'Team unavailable'}
              </p>
              <strong className="block break-words">{a.description}</strong>
              <StatusBadge
                value={a.status}
                text={a.status === 'ACCEPTED' ? 'Recorded' : undefined}
              />
              <p className="text-xs text-[var(--text-secondary)]">
                {date(a.startsAt)} – {date(a.endsAt)}
              </p>
            </button>
          ))}
          <Pager offset={offset} total={list.data?.total ?? 0} onChange={setOffset} />
        </section>
        <section
          aria-label="Checklist detail"
          className={'min-w-0 space-y-4 ' + (!mobileDetail ? 'hidden lg:block' : '')}
        >
          <button className={buttonClass + ' lg:hidden'} onClick={() => setMobileDetail(false)}>
            Back to checklists
          </button>
          {detail.isPending && selectedId && p.active && (
            <p className={cardClass}>Loading checklist…</p>
          )}
          <RequestError error={detail.error} retry={() => void detail.refetch()} />
          {current && (
            <>
              <article className={cardClass}>
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="text-xl font-bold break-words">{current.description}</h3>
                  <StatusBadge
                    value={current.status}
                    text={current.status === 'ACCEPTED' ? 'Recorded' : undefined}
                  />
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    ['Contractor', current.contractorName],
                    ['Team', current.teamName],
                    ['Zone', current.zoneName],
                    ['Assigned to', current.assignedToName],
                    ['Assigned by', current.assignedByName],
                  ].map(([name, value]) => (
                    <div key={name}>
                      <dt className="text-xs font-semibold text-[var(--text-secondary)]">{name}</dt>
                      <dd>{value ?? 'Unavailable'}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm">
                  Work window: {date(current.startsAt)} – {date(current.endsAt)}
                </p>
                {new Date(current.endsAt) < new Date() &&
                  !['ACCEPTED', 'CANCELLED'].includes(current.status) && (
                    <p className="text-sm text-[var(--semantic-red-text)]">
                      Work window has ended; this report still needs attention.
                    </p>
                  )}
                <p className="text-xs text-[var(--text-secondary)]">
                  Recording a report preserves its findings. It does not grant work or access
                  permission.
                </p>
                <div className="flex flex-wrap gap-2">
                  {representative &&
                    current.assignedTo === p.user.id &&
                    current.status === 'ASSIGNED' && (
                      <button
                        className={primaryClass}
                        disabled={mutation.isPending}
                        onClick={() =>
                          mutation.mutate({
                            fingerprint: JSON.stringify({ id: current.id, start: current.version }),
                            run: (commandId, signal) =>
                              p.client.checklistCommand(
                                p.token,
                                p.siteId,
                                current.id,
                                'start',
                                { commandId, expectedVersion: current.version },
                                { signal },
                              ),
                          })
                        }
                      >
                        Start checklist
                      </button>
                    )}
                  {representative &&
                    current.assignedTo === p.user.id &&
                    current.status === 'IN_PROGRESS' && (
                      <button
                        className={primaryClass}
                        onClick={() => open({ op: 'submit', version: current.version })}
                      >
                        Report checklist
                      </button>
                    )}
                  {safety && pending && pending.submittedBy !== p.user.id && (
                    <>
                      <button
                        className={primaryClass}
                        onClick={() => open({ op: 'record', version: current.version })}
                      >
                        Record checklist
                      </button>
                      <button
                        className={buttonClass}
                        onClick={() => open({ op: 'return', version: current.version })}
                      >
                        Request update
                      </button>
                    </>
                  )}
                  {safety && ['ASSIGNED', 'IN_PROGRESS'].includes(current.status) && (
                    <button
                      className={dangerClass}
                      onClick={() => open({ op: 'cancel', version: current.version })}
                    >
                      Cancel checklist
                    </button>
                  )}
                </div>
                <TechnicalDetails>
                  <p>Checklist {current.id}</p>
                  <p>Version {current.version}</p>
                </TechnicalDetails>
              </article>
              <section className={cardClass}>
                <h3 className="font-bold">Assigned criteria</h3>
                <ol className="list-decimal space-y-2 pl-5">
                  {current.items.map((i) => (
                    <li key={i.id} className="text-sm">
                      {i.text}
                      {i.evidenceRequired && (
                        <span className="ml-2 text-xs text-[var(--text-secondary)]">
                          Evidence required for Pass
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
              {!current.submissions.length && (
                <p className={cardClass}>No report has been submitted yet.</p>
              )}
              {[...current.submissions].reverse().map((submission, index) =>
                index === 0 ? (
                  <ChecklistReport
                    key={submission.id}
                    p={p}
                    current={current}
                    submission={submission}
                    safety={safety}
                    onIncident={(result) =>
                      open({ op: 'incident', version: current.version, result, submission })
                    }
                  />
                ) : (
                  <details key={submission.id} className={cardClass}>
                    <summary className="cursor-pointer text-sm font-semibold">
                      Earlier report · {date(submission.submittedAt)} ·{' '}
                      {submission.status.toLowerCase()}
                    </summary>
                    <ChecklistReport
                      p={p}
                      current={current}
                      submission={submission}
                      safety={safety}
                      onIncident={(result) =>
                        open({ op: 'incident', version: current.version, result, submission })
                      }
                    />
                  </details>
                ),
              )}
              <Audit items={current.audit} />
            </>
          )}
          {!selectedId && (
            <p className={cardClass}>Select a checklist to see its criteria and reports.</p>
          )}
        </section>
      </div>
      {editor && (
        <Dialog
          title={
            {
              create: 'Assign checklist',
              submit: 'Report checklist',
              record: 'Record checklist',
              return: 'Request checklist update',
              cancel: 'Cancel checklist',
              incident: 'Create incident from finding',
            }[editor.op]
          }
          onClose={close}
          pending={mutation.isPending}
          error={mutation.error}
          reload={reload}
        >
          {editor.op === 'create' ? (
            <CreateChecklistForm
              {...p}
              draft={draft}
              pending={mutation.isPending}
              onSubmit={(input: Omit<CreateChecklistCommand, 'commandId'>) =>
                mutation.mutate({
                  fingerprint: JSON.stringify(input),
                  run: (commandId, signal) =>
                    p.client.createSafetyChecklist(
                      p.token,
                      p.siteId,
                      { ...input, commandId },
                      { signal },
                    ),
                })
              }
            />
          ) : editor.op === 'submit' && current ? (
            <ReportChecklistForm
              items={current.items}
              pending={mutation.isPending}
              onSubmit={(results, files) => {
                const input = { expectedVersion: editor.version, results };
                mutation.mutate({
                  fingerprint: JSON.stringify({ id: current.id, ...input }),
                  files,
                  run: (commandId, signal) =>
                    p.client.submitSafetyChecklist(
                      p.token,
                      p.siteId,
                      current.id,
                      { ...input, commandId },
                      files,
                      { signal },
                    ),
                });
              }}
            />
          ) : editor.op === 'incident' && current && editor.result && editor.submission ? (
            <IncidentFindingForm
              current={current}
              result={editor.result}
              submission={editor.submission}
              pending={mutation.isPending}
              onSubmit={(input) =>
                mutation.mutate({
                  fingerprint: JSON.stringify(input),
                  run: (commandId, signal) =>
                    p.client.createIncident(p.token, p.siteId, { ...input, commandId }, { signal }),
                })
              }
            />
          ) : (
            current && (
              <CommandForm
                pending={mutation.isPending}
                label={
                  editor.op === 'record'
                    ? 'Record checklist'
                    : editor.op === 'return'
                      ? 'Request update'
                      : 'Cancel checklist'
                }
                onSubmit={(form) => {
                  const reason = String(form.get('reason') ?? '').trim();
                  if (editor.op === 'cancel')
                    mutation.mutate({
                      fingerprint: JSON.stringify({
                        id: current.id,
                        cancel: editor.version,
                        reason,
                      }),
                      run: (commandId, signal) =>
                        p.client.checklistCommand(
                          p.token,
                          p.siteId,
                          current.id,
                          'cancel',
                          { commandId, expectedVersion: editor.version, reason },
                          { signal },
                        ),
                    });
                  else if (pending) {
                    const input = {
                      expectedVersion: editor.version,
                      submissionId: pending.id,
                      decision:
                        editor.op === 'record' ? ('ACCEPTED' as const) : ('RETURNED' as const),
                      reason,
                    };
                    mutation.mutate({
                      fingerprint: JSON.stringify({ id: current.id, ...input }),
                      run: (commandId, signal) =>
                        p.client.checklistCommand(
                          p.token,
                          p.siteId,
                          current.id,
                          'review',
                          { ...input, commandId },
                          { signal },
                        ),
                    });
                  }
                }}
              >
                <Field
                  name="reason"
                  label={editor.op === 'record' ? 'Recording note' : 'Reason'}
                  type="textarea"
                  maxLength={2000}
                  required
                />
                {editor.op === 'record' && (
                  <p className="text-sm text-[var(--text-secondary)]">
                    Failed criteria remain failed after recording. You can create an Incident for a
                    verified finding.
                  </p>
                )}
              </CommandForm>
            )
          )}
        </Dialog>
      )}
    </div>
  );
}
function ChecklistReport({
  p,
  current,
  submission,
  safety,
  onIncident,
}: {
  p: WorkflowProps;
  current: ChecklistDetailResponse;
  submission: ChecklistSubmissionResponse;
  safety: boolean;
  onIncident: (result: ChecklistResultResponse) => void;
}) {
  return (
    <section
      className={cardClass + (submission.status === 'PENDING' ? ' border-[var(--accent)]' : '')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">
          {submission.status === 'PENDING' ? 'Report awaiting Safety' : 'Handling report'}
        </h3>
        <StatusBadge
          value={submission.status}
          text={submission.status === 'ACCEPTED' ? 'Recorded' : undefined}
        />
      </div>
      <p className="text-sm">
        Submitted by {submission.submittedByName ?? 'Account unavailable'} ·{' '}
        {date(submission.submittedAt)}
      </p>
      {current.items.map((item) => {
        const result = submission.results.find((r) => r.itemId === item.id);
        return result ? (
          <article key={result.id} className="space-y-3 border-t border-[var(--border)] pt-3">
            <div className="flex flex-wrap justify-between gap-2">
              <strong className="text-sm">
                {item.position + 1}. {item.text}
              </strong>
              <StatusBadge value={result.answer} />
            </div>
            {result.note && (
              <p className="whitespace-pre-wrap break-words text-sm">{result.note}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {result.evidence.map((e) => (
                <ChecklistEvidence key={e.id} {...p} assignmentId={current.id} evidence={e} />
              ))}
            </div>
            {safety &&
              submission.status === 'ACCEPTED' &&
              result.answer === 'FAIL' &&
              (result.incidentId ? (
                <p className="text-sm text-[var(--text-secondary)]">
                  An Incident is already linked to this finding.
                </p>
              ) : (
                <button className={buttonClass} onClick={() => onIncident(result)}>
                  Create incident
                </button>
              ))}
          </article>
        ) : null;
      })}
      {submission.reviewNote && (
        <p className="rounded-lg bg-[var(--surface-bone)] p-3 text-sm">
          By {submission.reviewedByName ?? 'Account unavailable'} · {date(submission.reviewedAt)}
          <br />
          {submission.reviewNote}
        </p>
      )}
    </section>
  );
}
function IncidentFindingForm({
  current,
  result,
  submission,
  pending,
  onSubmit,
}: {
  current: ChecklistDetailResponse;
  result: ChecklistResultResponse;
  submission: ChecklistSubmissionResponse;
  pending: boolean;
  onSubmit: (input: Omit<CreateIncidentCommand, 'commandId'>) => void;
}) {
  const [confirmed, setConfirmed] = useState(false),
    item = current.items.find((i) => i.id === result.itemId);
  return (
    <CommandForm
      pending={pending}
      label="Create incident"
      onSubmit={(form) =>
        onSubmit({
          sourceChecklistResultId: result.id,
          title: String(form.get('title') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          severity: String(form.get('severity')) as IncidentSeverity,
          occurredAt: new Date(String(form.get('occurredAt'))).toISOString(),
          zoneId: current.zoneId,
          alertIds: [],
          ...(confirmed
            ? {
                contractorId: current.contractorId,
                responsibilityReason: String(form.get('reason') ?? '').trim(),
                workerIds: [],
              }
            : {}),
        })
      }
    >
      <p className="text-sm">
        {current.contractorName ?? 'Contractor unavailable'} ·{' '}
        {current.teamName ?? 'Team unavailable'} · {current.zoneName ?? 'Zone unavailable'}
      </p>
      <Field
        name="title"
        label="Title"
        required
        maxLength={200}
        defaultValue={(item?.text ?? 'Checklist finding').slice(0, 200)}
      />
      <Field
        name="description"
        label="Description"
        type="textarea"
        required
        defaultValue={current.description + '\n' + (item?.text ?? '') + '\n' + result.note}
      />
      <label className="text-sm font-semibold">
        Severity
        <select className={fieldClass} name="severity" defaultValue="MEDIUM">
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <Field
        name="occurredAt"
        label="Occurred at"
        type="datetime-local"
        required
        defaultValue={localInput(submission.submittedAt)}
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I have verified that {current.contractorName ?? 'this contractor'} is responsible for this
        finding.
      </label>
      {confirmed && (
        <Field
          name="reason"
          label="Responsibility confirmation reason"
          type="textarea"
          maxLength={2000}
          required
        />
      )}
      <p className="text-xs text-[var(--text-secondary)]">
        Worker remains unknown. Confirm responsibility before handing over; source evidence stays on
        the checklist.
      </p>
    </CommandForm>
  );
}
