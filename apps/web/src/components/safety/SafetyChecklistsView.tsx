import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
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
  label,
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
  useTranslation();

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
    setEditor(null);
    setSelected('');
    setOffset(0);
    setStatus('');
    setAssignedTo('');
    setMobileDetail(false);
  }
  if (previousId !== p.initialChecklistId) {
    setPreviousId(p.initialChecklistId);
    setEditor(null);
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
          <p>{tr('safety_workspace.checklists_value1', { value1: p.context.caption })}</p>
          <div className="mt-2 flex gap-3">
            <button className={buttonClass} onClick={p.onBackToOverview}>
              {tr('safety_workspace.back_to_overview')}
            </button>
            <button className={buttonClass} onClick={p.onClearContext}>
              {tr('safety_workspace.clear_context_filter')}
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
            {representative && !safety
              ? tr('safety_workspace.my_checklists')
              : tr('safety_workspace.safety_checklists')}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {tr('safety_workspace.pre_work_reports_and_follow_up')}
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
            {tr('safety_workspace.new_checklist')}
          </button>
        )}
      </div>
      {!editor && <RequestError error={mutation.error} retry={reload} />}
      {mutation.isSuccess && (
        <p role="status" className="rounded-lg bg-[var(--semantic-green-bg)] p-3 text-sm">
          {tr('common.change_recorded')}
        </p>
      )}
      <div
        className={
          (mobileDetail ? 'hidden lg:flex ' : 'flex ') +
          'min-w-0 flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white p-3'
        }
      >
        <label className="text-sm font-semibold">
          {tr('common.status')}
          <select
            className={fieldClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setSelected('');
              setOffset(0);
            }}
          >
            <option value="">{tr('common.all_statuses_8ee573')}</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s === 'ACCEPTED' ? tr('safety_workspace.recorded') : label(s)}
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
        <button
          className={buttonClass}
          aria-label={tr('safety_workspace.refresh_checklists')}
          onClick={reload}
        >
          {tr('common.refresh')}
        </button>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
        <section
          aria-label={tr('safety_workspace.checklist_list')}
          className={'min-w-0 space-y-3 ' + (mobileDetail ? 'hidden lg:block' : '')}
        >
          {list.isPending && p.active && (
            <p className={cardClass}>{tr('safety_workspace.loading_checklists')}</p>
          )}
          <RequestError error={list.error} retry={() => void list.refetch()} />
          {list.data && !list.data.items.length && (
            <p className={cardClass}>{tr('safety_workspace.no_checklists_found')}</p>
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
                {a.contractorName ?? tr('common.contractor_unavailable')} ·{' '}
                {a.teamName ?? tr('safety_workspace.team_unavailable')}
              </p>
              <strong className="block break-words">{a.description}</strong>
              <StatusBadge
                value={a.status}
                text={a.status === 'ACCEPTED' ? tr('safety_workspace.recorded') : undefined}
              />
              <p className="text-xs text-[var(--text-secondary)]">
                {date(a.startsAt)} – {date(a.endsAt)}
              </p>
            </button>
          ))}
          <Pager offset={offset} total={list.data?.total ?? 0} onChange={setOffset} />
        </section>
        <section
          aria-label={tr('safety_workspace.checklist_detail')}
          className={'min-w-0 space-y-4 ' + (!mobileDetail ? 'hidden lg:block' : '')}
        >
          <button className={buttonClass + ' lg:hidden'} onClick={() => setMobileDetail(false)}>
            {tr('safety_workspace.back_to_checklists')}
          </button>
          {detail.isPending && selectedId && p.active && (
            <p className={cardClass}>{tr('safety_workspace.loading_checklist')}</p>
          )}
          <RequestError error={detail.error} retry={() => void detail.refetch()} />
          {current && (
            <>
              <article className={cardClass}>
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="text-xl font-bold break-words">{current.description}</h3>
                  <StatusBadge
                    value={current.status}
                    text={
                      current.status === 'ACCEPTED' ? tr('safety_workspace.recorded') : undefined
                    }
                  />
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {[
                    [tr('common.contractor'), current.contractorName],
                    [tr('labels.TEAM'), current.teamName],
                    [tr('common.zone'), current.zoneName],
                    [tr('common.assigned_to'), current.assignedToName],
                  ].map(([name, value]) => (
                    <div key={name}>
                      <dt className="text-xs font-semibold text-[var(--text-secondary)]">{name}</dt>
                      <dd>{value ?? tr('labels.UNAVAILABLE')}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-sm">
                  {tr('safety_workspace.work_window_value1_value2', {
                    value1: date(current.startsAt),
                    value2: date(current.endsAt),
                  })}
                </p>
                <p className="text-sm">
                  {tr('safety_workspace.first_report_value1', {
                    value1: current.firstSubmittedAt
                      ? (new Date(current.firstSubmittedAt) <= new Date(current.startsAt)
                          ? tr('safety_workspace.submitted_before_planned_start')
                          : tr('safety_workspace.submitted_after_planned_start')) +
                        ' · ' +
                        date(current.firstSubmittedAt)
                      : tr('safety_workspace.not_submitted'),
                  })}
                </p>
                {current.status === 'SUBMITTED' && (
                  <p className="text-sm">{tr('safety_workspace.awaiting_safety_review')}</p>
                )}
                {new Date(current.endsAt) < new Date() &&
                  !['ACCEPTED', 'CANCELLED'].includes(current.status) && (
                    <p className="text-sm text-[var(--semantic-red-text)]">
                      {tr('safety_workspace.work_window_ended_report_pending')}
                    </p>
                  )}
                <p className="text-xs text-[var(--text-secondary)]">
                  {tr('safety_workspace.recorded_reports_do_not_grant_work_permission')}
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
                        {tr('safety_workspace.start_checklist')}
                      </button>
                    )}
                  {representative &&
                    current.assignedTo === p.user.id &&
                    current.status === 'IN_PROGRESS' && (
                      <button
                        className={primaryClass}
                        onClick={() => open({ op: 'submit', version: current.version })}
                      >
                        {tr('safety_workspace.report_checklist')}
                      </button>
                    )}
                  {safety && pending && pending.submittedBy !== p.user.id && (
                    <>
                      <button
                        className={primaryClass}
                        onClick={() => open({ op: 'record', version: current.version })}
                      >
                        {tr('safety_workspace.record_checklist')}
                      </button>
                      <button
                        className={buttonClass}
                        onClick={() => open({ op: 'return', version: current.version })}
                      >
                        {tr('safety_workspace.request_update')}
                      </button>
                    </>
                  )}
                  {safety && ['ASSIGNED', 'IN_PROGRESS'].includes(current.status) && (
                    <button
                      className={dangerClass}
                      onClick={() => open({ op: 'cancel', version: current.version })}
                    >
                      {tr('safety_workspace.cancel_checklist')}
                    </button>
                  )}
                </div>
                <TechnicalDetails>
                  <p>
                    {tr('common.assigned_by_value', {
                      value1: current.assignedByName ?? tr('labels.UNAVAILABLE'),
                    })}
                  </p>
                  <p>{tr('safety_workspace.checklist_value1', { value1: current.id })}</p>
                  <p>{tr('common.version_value', { value1: current.version })}</p>
                </TechnicalDetails>
              </article>
              <details key={current.id} open={!current.submissions.length} className={cardClass}>
                <summary className="cursor-pointer font-semibold">
                  {tr('safety_workspace.assigned_criteria_value1', {
                    value1: current.items.length,
                  })}
                </summary>
                <ol className="list-decimal space-y-2 pl-5">
                  {current.items.map((i) => (
                    <li key={i.id} className="text-sm">
                      {i.text}
                      {i.evidenceRequired && (
                        <span className="ml-2 text-xs text-[var(--text-secondary)]">
                          {tr('safety_workspace.evidence_required_for_pass')}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
              {!current.submissions.length && (
                <p className={cardClass}>
                  {tr('safety_workspace.no_report_has_been_submitted_yet')}
                </p>
              )}
              {[...current.submissions].reverse().map((submission, index) =>
                index === 0 ? (
                  <ChecklistReport
                    key={submission.id}
                    p={p}
                    current={current}
                    submission={submission}
                    safety={safety}
                    onOpenIncident={p.onIncident}
                    onIncident={(result) =>
                      open({ op: 'incident', version: current.version, result, submission })
                    }
                  />
                ) : (
                  <details key={submission.id} className={cardClass}>
                    <summary className="cursor-pointer text-sm font-semibold">
                      {tr('safety_workspace.earlier_report_value1_value2', {
                        value1: date(submission.submittedAt),
                        value2: label(submission.status),
                      })}
                    </summary>
                    <ChecklistReport
                      p={p}
                      current={current}
                      submission={submission}
                      safety={safety}
                      onOpenIncident={p.onIncident}
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
            <p className={cardClass}>
              {tr('safety_workspace.select_a_checklist_to_see_its_criteria_and_reports')}
            </p>
          )}
        </section>
      </div>
      {editor && (
        <Dialog
          title={
            {
              create: tr('safety_workspace.assign_checklist'),
              submit: tr('safety_workspace.report_checklist'),
              record: tr('safety_workspace.record_checklist'),
              return: tr('safety_workspace.request_checklist_update'),
              cancel: tr('safety_workspace.cancel_checklist'),
              incident: tr('safety_workspace.create_incident_from_finding'),
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
                    ? tr('safety_workspace.record_checklist')
                    : editor.op === 'return'
                      ? tr('safety_workspace.request_update')
                      : tr('safety_workspace.cancel_checklist')
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
                  label={editor.op === 'record' ? tr('common.recording_note') : tr('common.reason')}
                  type="textarea"
                  maxLength={2000}
                  required
                />
                {editor.op === 'record' && (
                  <p className="text-sm text-[var(--text-secondary)]">
                    {tr(
                      'safety_workspace.failed_criteria_remain_failed_after_recording_you_can_create_an_incident_for_a_verified_finding',
                    )}
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
  onOpenIncident,
}: {
  p: WorkflowProps;
  current: ChecklistDetailResponse;
  submission: ChecklistSubmissionResponse;
  safety: boolean;
  onIncident: (result: ChecklistResultResponse) => void;
  onOpenIncident: (id: string) => void;
}) {
  useTranslation();

  return (
    <section
      className={cardClass + (submission.status === 'PENDING' ? ' border-[var(--accent)]' : '')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">
          {submission.status === 'PENDING'
            ? tr('safety_workspace.report_awaiting_safety')
            : tr('safety_workspace.handling_report')}
        </h3>
        <StatusBadge
          value={submission.status}
          text={submission.status === 'ACCEPTED' ? tr('safety_workspace.recorded') : undefined}
        />
      </div>
      <p className="text-sm">
        {tr('safety_workspace.submitted_by_value1_value2', {
          value1: submission.submittedByName ?? tr('common.account_unavailable'),
          value2: date(submission.submittedAt),
        })}
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
            {submission.status === 'ACCEPTED' &&
              result.answer === 'FAIL' &&
              (result.incidentId ? (
                <div className="text-sm">
                  <p>
                    {!result.linkedIncident
                      ? tr(
                          'safety_workspace.incident_follow_up_unavailable_with_your_current_access',
                        )
                      : result.linkedIncident.status === 'CLOSED'
                        ? tr('safety_workspace.follow_up_closed_original_fail_is_retained')
                        : tr('safety_workspace.incident_follow_up_still_needs_attention')}
                  </p>
                  {result.linkedIncident && (
                    <button
                      className={buttonClass}
                      onClick={() => onOpenIncident(result.linkedIncident!.id)}
                    >
                      {tr('safety_workspace.view_incident_value1', {
                        value1: label(result.linkedIncident.status),
                      })}
                    </button>
                  )}
                </div>
              ) : safety ? (
                <button className={buttonClass} onClick={() => onIncident(result)}>
                  {tr('common.create_incident')}
                </button>
              ) : (
                <p className="text-sm">
                  {tr('safety_workspace.no_incident_available_for_this_finding')}
                </p>
              ))}
          </article>
        ) : null;
      })}
      {submission.reviewNote && (
        <p className="rounded-lg bg-[var(--surface-bone)] p-3 text-sm">
          {tr('safety_workspace.by_value1_value2', {
            value1: submission.reviewedByName ?? tr('common.account_unavailable'),
            value2: date(submission.reviewedAt),
          })}
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
  useTranslation();

  const [confirmed, setConfirmed] = useState(false),
    item = current.items.find((i) => i.id === result.itemId);
  return (
    <CommandForm
      pending={pending}
      label={tr('common.create_incident')}
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
        {current.contractorName ?? tr('common.contractor_unavailable')} ·{' '}
        {current.teamName ?? tr('safety_workspace.team_unavailable')} ·{' '}
        {current.zoneName ?? tr('common.zone_unavailable')}
      </p>
      <Field
        name="title"
        label={tr('common.title')}
        required
        maxLength={200}
        defaultValue={(item?.text ?? tr('safety_workspace.checklist_finding')).slice(0, 200)}
      />
      <Field
        name="description"
        label={tr('common.description')}
        type="textarea"
        required
        defaultValue={current.description + '\n' + (item?.text ?? '') + '\n' + result.note}
      />
      <label className="text-sm font-semibold">
        {tr('common.severity')}
        <select className={fieldClass} name="severity" defaultValue="MEDIUM">
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </select>
      </label>
      <Field
        name="occurredAt"
        label={tr('safety_workspace.occurred_at')}
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
        {tr('safety_workspace.i_have_verified_that_value1_is_responsible_for_this_finding', {
          value1: current.contractorName ?? tr('safety_workspace.this_contractor'),
        })}
      </label>
      {confirmed && (
        <Field
          name="reason"
          label={tr('safety_workspace.responsibility_confirmation_reason')}
          type="textarea"
          maxLength={2000}
          required
        />
      )}
      <p className="text-xs text-[var(--text-secondary)]">
        {tr(
          'safety_workspace.worker_remains_unknown_confirm_responsibility_before_handing_over_source_evidence_stays_on_the_checklist',
        )}
      </p>
    </CommandForm>
  );
}
