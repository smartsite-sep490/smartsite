import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
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
} from './SafetyWorkflowUi';
const statuses = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CANCELLED'];
type Editor = 'create' | 'submit' | 'review' | 'cancel';
const titles = {
  get create() {
    return tr('common.new_safety_task');
  },
  get submit() {
    return tr('common.submit_task_result');
  },
  get review() {
    return tr('common.review_task');
  },
  get cancel() {
    return tr('common.cancel_task');
  },
};
export function SafetyTasksView(p: WorkflowProps) {
  useTranslation();

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
          <h2 className="text-xl font-bold">{tr('common.safety_tasks')}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {manager
              ? tr('safety_tasks_view.assign_site_safety_work_and_verify_the_reported_results')
              : tr(
                  'safety_tasks_view.complete_your_assigned_safety_work_and_report_results_to_the_site_manager',
                )}
          </p>
        </div>
        {manager && (
          <button
            className={primaryClass}
            disabled={mutation.isPending}
            onClick={() => open('create')}
          >
            {tr('common.new_safety_task')}
          </button>
        )}
      </div>
      {!editor && <RequestError error={mutation.error} retry={reload} />}
      {mutation.isSuccess && (
        <p
          role="status"
          className="rounded-lg bg-[var(--semantic-green-bg)] p-3 text-sm text-[var(--semantic-green-text)]"
        >
          {tr('common.change_recorded')}
        </p>
      )}
      <div
        className={
          (mobileDetail ? 'hidden lg:flex ' : 'flex ') +
          'flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-white p-4'
        }
      >
        <label className="text-sm font-semibold">
          {tr('common.status')}
          <select
            className={fieldClass}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">{tr('common.all_statuses_8ee573')}</option>
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
          {tr('common.refresh_tasks')}
        </button>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
        <section
          aria-label={tr('common.safety_task_list')}
          className={'min-w-0 space-y-3 ' + (mobileDetail ? 'hidden lg:block' : '')}
        >
          {list.isPending && <p className={cardClass}>{tr('common.loading_tasks')}</p>}
          <RequestError error={list.error} retry={() => void list.refetch()} />
          {list.data && !list.data.items.length && (
            <p className={cardClass + ' text-sm text-[var(--text-secondary)]'}>
              {tr('safety_tasks_view.no_safety_tasks_found')}
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
              <p className="text-xs text-[var(--text-secondary)]">
                {tr('common.deadline_value', { value1: date(item.dueAt) })}
              </p>
            </button>
          ))}
          {list.data && <Pager offset={offset} total={list.data.total} onChange={setOffset} />}
        </section>
        <section
          aria-label={tr('common.safety_task_detail')}
          className={'min-w-0 space-y-4 ' + (!mobileDetail ? 'hidden lg:block' : '')}
        >
          <button className={buttonClass + ' lg:hidden'} onClick={() => setMobileDetail(false)}>
            {tr('common.back_to_tasks')}
          </button>
          {!selected && (
            <div className={cardClass + ' py-14 text-center'}>
              <h3 className="font-bold">{tr('safety_tasks_view.select_a_safety_task')}</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                {tr('safety_tasks_view.view_its_progress_result_and_activity_here')}
              </p>
            </div>
          )}
          {selected && detail.isPending && <p className={cardClass}>{tr('common.loading_task')}</p>}
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
                  {tr('incident_view.value_deadline_value', {
                    value1: current.assignedToName ?? tr('common.account_unavailable'),
                    value2: date(current.dueAt),
                  })}
                </p>
                <p className="text-sm">
                  {tr('common.assigned_by_value', {
                    value1: current.assignedByName ?? tr('common.account_unavailable'),
                  })}
                </p>
                {current.zoneId && (
                  <p className="text-sm">
                    {tr('common.zone_value_22c565', {
                      value1: current.zoneName ?? tr('common.zone_unavailable'),
                    })}
                  </p>
                )}
                {current.dueAt &&
                  new Date(current.dueAt).getTime() < detail.dataUpdatedAt &&
                  !['VERIFIED', 'CANCELLED'].includes(current.status) && (
                    <p className="text-sm font-semibold text-[var(--semantic-red-text)]">
                      {tr('common.past_deadline')}
                    </p>
                  )}
                <div className="flex flex-wrap gap-2">
                  {mine && current.status === 'ASSIGNED' && (
                    <button
                      className={primaryClass}
                      disabled={mutation.isPending}
                      onClick={() => command('start', { expectedVersion: current.version })}
                    >
                      {tr('common.start_task')}
                    </button>
                  )}
                  {mine && current.status === 'IN_PROGRESS' && (
                    <button
                      className={primaryClass}
                      disabled={mutation.isPending}
                      onClick={() => open('submit')}
                    >
                      {tr('common.submit_task_result')}
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
                        {tr('common.review_task')}
                      </button>
                    )}
                  {manager && !['VERIFIED', 'CANCELLED'].includes(current.status) && (
                    <button
                      className={dangerClass}
                      disabled={mutation.isPending}
                      onClick={() => open('cancel')}
                    >
                      {tr('common.cancel_task')}
                    </button>
                  )}
                </div>
                {current.status === 'COMPLETED' && (
                  <p className="rounded-lg bg-[var(--semantic-blue-bg)] p-3 text-sm text-[var(--semantic-blue-text)]">
                    {tr('safety_tasks_view.awaiting_site_manager_verification')}
                  </p>
                )}
                <TechnicalDetails>
                  <p>{tr('common.task_value', { value1: current.id })}</p>
                  <p>{tr('common.version_value', { value1: current.version })}</p>
                  <p>{tr('common.assignee_value', { value1: current.assignedTo })}</p>
                  {current.zoneId && <p>{tr('common.zone_value', { value1: current.zoneId })}</p>}
                  {current.sourceAlertId && (
                    <p>
                      {tr('common.source_alert_value_fa081c', { value1: current.sourceAlertId })}
                    </p>
                  )}
                  {current.sourceIncidentId && (
                    <p>
                      {tr('common.source_incident_value', { value1: current.sourceIncidentId })}
                    </p>
                  )}
                </TechnicalDetails>
              </article>
              <section className={cardClass}>
                <h3 className="font-bold">{tr('common.current_result')}</h3>
                {current.resultSummary ? (
                  <>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {current.resultSummary}
                    </p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {tr('common.submitted_value', { value1: date(current.completedAt) })}
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
                  <p className="text-sm text-[var(--text-secondary)]">
                    {tr('safety_tasks_view.no_result_submitted_yet')}
                  </p>
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
                ? tr('common.create_task')
                : editor === 'review'
                  ? tr('common.record_task_review')
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
                  {tr('common.task_kind')}
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
                <Field
                  name="description"
                  label={tr('common.task_description')}
                  type="textarea"
                  required
                />
                <Field
                  name="dueAt"
                  label={tr('incident_view.deadline_optional_local_time')}
                  type="datetime-local"
                />
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold">
                    {tr('common.optional_references')}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <Field name="zoneId" label={tr('common.zone_id_optional')} />
                    <Field
                      name="sourceAlertId"
                      label={tr('safety_tasks_view.source_alert_id_optional')}
                    />
                    <Field
                      name="sourceIncidentId"
                      label={tr('safety_tasks_view.source_incident_id_optional')}
                    />
                  </div>
                </details>
              </>
            )}
            {editor === 'submit' && <ResultFields />}
            {editor === 'review' && (
              <>
                <label className="block text-sm font-semibold">
                  {tr('common.decision')}
                  <select name="decision" className={fieldClass}>
                    <option value="verify">{tr('common.verify_eea274')}</option>
                    <option value="return">{tr('common.return_for_correction')}</option>
                  </select>
                </label>
                <Field
                  name="reason"
                  label={tr('common.task_review_reason')}
                  type="textarea"
                  required
                />
                <p className="text-xs text-[var(--text-secondary)]">
                  {tr(
                    'safety_tasks_view.returning_a_task_keeps_its_earlier_result_in_the_activity_history',
                  )}
                </p>
              </>
            )}
            {editor === 'cancel' && (
              <>
                <p className="text-sm text-[var(--text-secondary)]">
                  {tr(
                    'safety_tasks_view.cancel_this_task_its_recorded_results_and_history_will_be_retained',
                  )}
                </p>
                <Field
                  name="reason"
                  label={tr('common.cancellation_reason')}
                  type="textarea"
                  required
                />
              </>
            )}
          </CommandForm>
        </Dialog>
      )}
    </div>
  );
}
