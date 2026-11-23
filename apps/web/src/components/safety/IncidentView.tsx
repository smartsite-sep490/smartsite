import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import {
  type WorkflowProps,
  type WithoutCommandId,
  hasRole,
  resetWorkflowDetailScroll,
  text,
  ids,
  deadline,
  date,
  label,
  fieldClass,
  buttonClass,
  primaryClass,
  cardClass,
  useWorkflowCommand,
} from './safety-workflow';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  ConfirmIncidentResponsibilityCommand,
  CorrectIncidentResponsibilityCommand,
  TransferCorrectiveActionCommand,
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
  WorkflowDetailTabs,
  WorkflowSplit,
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
} from './SafetyWorkflowUi';
export interface IncidentViewProps extends WorkflowProps {
  context?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  initialAlertId?: string;
  initialIncidentId?: string;
  onOpenChecklist?: (id: string) => void;
  initialActionId?: string;
  onSelect?: (incidentId: string) => void;
  onSourceConsumed?: () => void;
}
const statuses = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'CLOSED', 'REOPENED'];
type Command =
  | ConfirmIncidentResponsibilityCommand
  | CorrectIncidentResponsibilityCommand
  | TransferCorrectiveActionCommand
  | VersionCommand
  | ReasonCommand
  | LinkIncidentAlertsCommand
  | AssignCorrectiveActionCommand
  | SubmitSafetyResultCommand
  | ReviewSubmissionCommand
  | ReopenIncidentCommand;
type Editor = {
  op:
    | 'responsibility'
    | 'correct-responsibility'
    | 'transfer'
    | 'create'
    | 'link'
    | 'assign'
    | 'submit'
    | 'review'
    | 'reopen';
  actionId?: string;
  submissionId?: string;
  decision?: 'APPROVED' | 'REJECTED';
};
const titles = {
  get responsibility() {
    return tr('common.confirm_responsibility');
  },
  get 'correct-responsibility'() {
    return tr('common.correct_responsibility');
  },
  get transfer() {
    return tr('common.transfer_action');
  },
  get create() {
    return tr('common.new_incident');
  },
  get link() {
    return tr('common.link_alerts');
  },
  get assign() {
    return tr('incident_view.hand_over_to_contractor');
  },
  get submit() {
    return tr('common.report_handling_outcome');
  },
  get review() {
    return tr('common.record_handling_outcome');
  },
  get reopen() {
    return tr('common.reopen_incident');
  },
};
export function IncidentView(p: IncidentViewProps) {
  useTranslation();

  const [occurredDefault] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  );
  const safety = hasRole(p, 'SAFETY_OFFICER'),
    representative = hasRole(p, 'CONTRACTOR_REPRESENTATIVE');
  const [resultFile, setResultFile] = useState<File>();
  const [createAlertIds, setCreateAlertIds] = useState<string[]>(
    p.initialAlertId ? [p.initialAlertId] : [],
  );
  const [selected, setSelected] = useState(p.initialIncidentId ?? ''),
    [status, setStatus] = useState(''),
    [assignedTo, setAssignedTo] = useState(''),
    [offset, setOffset] = useState(0),
    [mobileDetail, setMobileDetail] = useState(!!p.initialIncidentId),
    [editor, setEditor] = useState<Editor | undefined>(
      p.initialAlertId ? { op: 'create' } : undefined,
    );
  const [previousIncidentLink, setPreviousIncidentLink] = useState(p.initialIncidentId);
  if (previousIncidentLink !== p.initialIncidentId) {
    setPreviousIncidentLink(p.initialIncidentId);
    if (p.initialIncidentId) {
      setSelected(p.initialIncidentId);
      setMobileDetail(true);
    }
  }
  const mutation = useWorkflowCommand(p, (id) => {
    setSelected(id);
    setMobileDetail(true);
    setEditor(undefined);
    setResultFile(undefined);
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
    setResultFile(undefined);
    setEditor(next);
  };
  const command = (
    op:
      | 'responsibility'
      | 'correct-responsibility'
      | 'transfer'
      | 'link'
      | 'assign'
      | 'start'
      | 'submit'
      | 'review'
      | 'reopen',
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
  const linkedActionId = selected === p.initialIncidentId ? p.initialActionId : undefined;
  const [previousActionLink, setPreviousActionLink] = useState(linkedActionId);
  const [detailTab, setDetailTab] = useState(p.initialActionId ? 'handling' : 'summary');
  const panelId = useId();
  const detailScroll = useRef<HTMLDivElement>(null);
  const [actionFooter, setActionFooter] = useState<HTMLDivElement | null>(null);
  const [chosenAction, setChosenAction] = useState(p.initialActionId ?? '');
  const [shownIncident, setShownIncident] = useState(p.initialIncidentId ?? '');
  if (shownIncident !== selected) {
    setShownIncident(selected);
    setChosenAction(p.initialIncidentId === selected ? (p.initialActionId ?? '') : '');
    setDetailTab(p.initialIncidentId === selected && p.initialActionId ? 'handling' : 'summary');
  }
  if (previousActionLink !== linkedActionId) {
    setPreviousActionLink(linkedActionId);
    setChosenAction(linkedActionId ?? '');
    setDetailTab(linkedActionId ? 'handling' : 'summary');
  }
  const changeDetailTab = (next: string) => {
    setDetailTab(next);
    resetWorkflowDetailScroll(detailScroll.current);
  };
  const current = detail.data,
    action = current?.actions.find((a) => a.id === editor?.actionId);
  const editorBlocked =
    !!editor &&
    (editor.op === 'submit'
      ? !representative ||
        !action ||
        !!action.supersededAt ||
        action.assignedTo !== p.user.id ||
        action.status !== 'IN_PROGRESS'
      : editor.op === 'review'
        ? !safety ||
          !action ||
          action.status !== 'SUBMITTED' ||
          current?.status === 'CLOSED' ||
          !!action.supersededAt ||
          !action.submissions.some(
            (s) =>
              s.id === editor.submissionId && s.status === 'PENDING' && s.submittedBy !== p.user.id,
          )
        : false);
  const editorDisabled =
    editorBlocked || (editor?.op !== 'create' && (detail.isFetching || detail.isError));
  const currentIncidentId = current?.id;
  useEffect(() => {
    if (linkedActionId && currentIncidentId) {
      document.getElementById('action-' + linkedActionId)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [linkedActionId, currentIncidentId]);
  const currentActions = current?.actions.filter((a) => !a.supersededAt) ?? [];
  const unavailableTarget =
    !!linkedActionId &&
    !!current &&
    !current.actions.some((a) => a.id === linkedActionId && (safety || a.assignedTo === p.user.id));
  const handlingActionId =
    chosenAction || currentActions.find((a) => safety || a.assignedTo === p.user.id)?.id;

  return (
    <div className="workflow-incident-screen">
      <div
        className={
          (mobileDetail ? 'hidden lg:flex ' : 'flex ') +
          'flex-wrap items-start justify-between gap-3'
        }
      >
        <div>
          {p.onBack && (
            <button className={buttonClass} onClick={p.onBack}>
              {p.backLabel}
            </button>
          )}
          <h2 className="text-xl font-bold">
            {representative && !safety ? tr('common.my_assigned_cases') : tr('common.incidents')}
          </h2>
          {!p.context && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {representative && !safety
                ? tr('incident_view.handle_cases_independently_and_report_the_outcome_to_safety')
                : tr(
                    'incident_view.confirm_responsibility_hand_over_to_the_contractor_and_record_the_handling_outcome',
                  )}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {p.context}
          {safety && (
            <button
              className={primaryClass}
              disabled={mutation.isPending}
              onClick={() => open({ op: 'create' })}
            >
              {tr('common.new_incident')}
            </button>
          )}
        </div>
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
          <SmartNativeSelect
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
          </SmartNativeSelect>
        </label>
        {safety && (
          <Assignee
            p={p}
            role="CONTRACTOR_REPRESENTATIVE"
            value={assignedTo}
            onChange={(value) => {
              setAssignedTo(value);
              setOffset(0);
            }}
          />
        )}
        <button className={buttonClass} onClick={reload}>
          {tr('common.refresh_incidents')}
        </button>
      </div>
      <WorkflowSplit className="workflow-split grid items-start gap-5 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1.35fr)]">
        <section
          aria-label={tr('common.incident_list')}
          className={'workflow-list-pane min-w-0 ' + (mobileDetail ? 'hidden lg:flex' : '')}
        >
          <div className="workflow-list-items custom-scrollbar space-y-3">
            {list.isPending && <p className={cardClass}>{tr('common.loading_incidents')}</p>}
            <RequestError error={list.error} retry={() => void list.refetch()} />
            {list.data && !list.data.items.length && (
              <p className={cardClass + ' text-sm text-[var(--text-secondary)]'}>
                {tr('common.no_incidents_found')}
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
                  p.onSelect?.(item.id);
                  setMobileDetail(true);
                  resetWorkflowDetailScroll(detailScroll.current);
                  mutation.reset();
                }}
              >
                <strong className="line-clamp-2 break-words text-sm">{item.title}</strong>
                <div className="workflow-list-statuses flex flex-wrap gap-2">
                  <span className="text-xs">
                    <StatusBadge value={item.status} />
                  </span>
                  <span className="text-xs">
                    <StatusBadge value={item.severity} />
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  {tr('common.occurred_value', { value1: date(item.occurredAt) })}
                </p>
              </button>
            ))}
          </div>
          {list.data && <Pager offset={offset} total={list.data.total} onChange={setOffset} />}
        </section>
        <section
          aria-label={tr('common.incident_detail')}
          className={'workflow-detail-pane min-w-0 ' + (!mobileDetail ? 'hidden lg:flex' : '')}
        >
          <button className={buttonClass + ' lg:hidden'} onClick={() => setMobileDetail(false)}>
            {tr('common.back_to_incidents')}
          </button>
          {!selected && (
            <div className={cardClass + ' py-14 text-center'}>
              <h3 className="font-bold">{tr('common.select_an_incident')}</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                {tr('incident_view.view_its_source_alerts_corrective_actions_and_history_here')}
              </p>
            </div>
          )}
          {detail.isPending && selected && (
            <p className={cardClass}>{tr('common.loading_incident')}</p>
          )}
          <RequestError error={detail.error} retry={() => void detail.refetch()} />
          {current && (
            <>
              <div className="workflow-detail-navigation">
                <header className="workflow-detail-heading">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="min-w-0 break-words text-xl font-bold">{current.title}</h3>
                    <div className="flex gap-2">
                      <span className="text-xs">
                        {tr('common.status_755c8b')}
                        <StatusBadge value={current.status} />
                      </span>
                      <span className="text-xs">
                        {tr('safety_workspace.severity')}
                        <StatusBadge value={current.severity} />
                      </span>
                    </div>
                  </div>
                </header>
                <WorkflowDetailTabs
                  value={detailTab}
                  onChange={changeDetailTab}
                  panelId={panelId}
                  options={[
                    { value: 'summary', label: tr('safetyUi.summary') },
                    { value: 'handling', label: tr('safetyUi.handling') },
                    { value: 'evidence', label: tr('safetyUi.evidence') },
                    { value: 'history', label: tr('safetyUi.history') },
                  ]}
                />
              </div>
              <div
                ref={detailScroll}
                role="tabpanel"
                id={panelId}
                aria-labelledby={panelId + '-' + detailTab}
                className="workflow-detail-content custom-scrollbar space-y-4"
              >
                <article hidden={detailTab !== 'summary'} className={cardClass}>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {current.description}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {tr('common.occurred_valuevalue', {
                      value1: date(current.occurredAt),
                      value2:
                        current.closedAt && ' · ' + label('CLOSED') + ' ' + date(current.closedAt),
                    })}
                  </p>
                  <p className="text-sm">
                    {tr('common.reported_by_value', {
                      value1: current.reportedByName ?? tr('common.account_unavailable'),
                    })}
                  </p>
                  {current.zoneId && (
                    <p className="text-sm">
                      {tr('common.zone_value_22c565', {
                        value1: current.zoneName ?? tr('common.zone_unavailable'),
                      })}
                    </p>
                  )}
                  <section className="space-y-2 rounded-lg bg-[var(--surface-bone)] p-4">
                    <h3 className="font-bold">{tr('common.responsibility')}</h3>
                    <p className="text-sm">
                      {current.contractorId ? (
                        <strong>
                          {current.contractorName ?? tr('common.contractor_unavailable')}
                        </strong>
                      ) : (
                        tr('incident_view.unresolved_safety_must_confirm_the_contractor')
                      )}
                    </p>
                    <p className="text-sm">
                      {current.workerIds?.length
                        ? current.workers?.length
                          ? current.workers
                              .map((w) => w.displayName + ' · ' + w.externalId)
                              .join(', ')
                          : tr('common.worker_references_unavailable')
                        : tr(
                            'incident_view.worker_identity_unknown_the_contractor_can_handle_the_case_after_safety_confirms_r',
                          )}
                    </p>
                    {current.responsibilityReason && (
                      <p className="whitespace-pre-wrap text-sm">{current.responsibilityReason}</p>
                    )}
                    {safety && (current.status !== 'CLOSED' || !current.contractorId) && (
                      <button
                        className={current.contractorId ? buttonClass : primaryClass}
                        disabled={mutation.isPending}
                        onClick={() => open({ op: 'responsibility' })}
                      >
                        {tr('common.confirm_responsibility')}
                      </button>
                    )}
                    {safety && current.contractorId && current.actions.length > 0 && (
                      <button
                        className={buttonClass}
                        disabled={mutation.isPending}
                        onClick={() => open({ op: 'correct-responsibility' })}
                      >
                        {tr('common.correct_responsibility')}
                      </button>
                    )}
                    {current.responsibilityConfirmedAt && (
                      <p className="text-xs text-[var(--text-secondary)]">
                        {tr('common.confirmed')} {date(current.responsibilityConfirmedAt)}
                      </p>
                    )}
                  </section>
                  {current.status !== 'CLOSED' &&
                    currentActions.some((a) => a.status === 'CLOSED') && (
                      <p className="text-sm">{tr('incident_view.other_actions_remain_open')}</p>
                    )}
                </article>
                <div hidden={detailTab !== 'evidence'} className="space-y-4">
                  {current.sourceChecklist && (
                    <section className={cardClass}>
                      <h3 className="font-bold">{tr('safety_workspace.checklist_finding')}</h3>
                      <p className="text-sm">{current.sourceChecklist.description}</p>
                      <strong className="text-sm">{current.sourceChecklist.itemText}</strong>
                      <p className="whitespace-pre-wrap text-sm">{current.sourceChecklist.note}</p>
                      {p.onOpenChecklist && (
                        <button
                          className={buttonClass}
                          onClick={() => p.onOpenChecklist!(current.sourceChecklist!.assignmentId)}
                        >
                          {tr('safety_workspace.view_source_checklist_and_evidence')}
                        </button>
                      )}
                    </section>
                  )}

                  <section className={cardClass}>
                    <h3 className="font-bold">
                      {tr('common.source_alerts')}{' '}
                      <span className="text-[var(--text-secondary)]">
                        ({current.alerts.length})
                      </span>
                    </h3>
                    {!current.alerts.length && (
                      <p className="text-sm text-[var(--text-secondary)]">
                        {current.sourceChecklistResultId
                          ? tr(
                              'safety_workspace.created_from_a_recorded_checklist_finding_no_linked_ai_alert',
                            )
                          : tr('incident_view.manual_incident_no_source_alert')}
                      </p>
                    )}
                    {current.alerts.map((alert, index) => (
                      <SourceAlert
                        key={alert.id}
                        p={p}
                        incidentId={current.id}
                        alertId={alert.id}
                        position={index + 1}
                      />
                    ))}
                  </section>
                </div>
                <section hidden={detailTab !== 'handling'} className="space-y-3">
                  {unavailableTarget && <p role="status">{tr('safetyUi.handoverUnavailable')}</p>}
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold">
                      {tr('common.handovers_value_current', { value1: currentActions.length })}
                    </h3>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {tr('common.value_outcomes_recorded', {
                        value1: currentActions.filter((a) => a.status === 'CLOSED').length,
                      })}
                    </span>
                  </div>
                  {!current.actions.length && (
                    <p className={cardClass + ' text-sm text-[var(--text-secondary)]'}>
                      {tr('common.no_handover_yet')}
                    </p>
                  )}
                  {current.actions.map((a) => (
                    <Action
                      key={a.id}
                      p={p}
                      incident={current}
                      action={a}
                      footer={
                        a.id === handlingActionId && detailTab === 'handling' ? actionFooter : null
                      }
                      selected={a.id === handlingActionId}
                      onSelect={() => setChosenAction(a.id)}
                      pending={mutation.isPending || unavailableTarget}
                      checkedAt={detail.dataUpdatedAt}
                      command={command}
                      open={open}
                    />
                  ))}
                </section>
                <div hidden={detailTab !== 'history'}>
                  <Audit items={current.audit} />
                </div>
              </div>
              {detailTab === 'summary' && safety && (
                <footer className="workflow-detail-footer">
                  {' '}
                  {safety && (
                    <div className="flex flex-wrap gap-2">
                      {current.status === 'CLOSED' ? (
                        <button
                          className={primaryClass}
                          disabled={mutation.isPending || !current.contractorId}
                          onClick={() => open({ op: 'reopen' })}
                        >
                          {tr('common.reopen_incident')}
                        </button>
                      ) : (
                        <>
                          <button
                            className={currentActions.length ? buttonClass : primaryClass}
                            disabled={mutation.isPending || !current.contractorId}
                            onClick={() => open({ op: 'assign' })}
                          >
                            {tr('incident_view.hand_over_to_contractor')}
                          </button>
                          <button
                            className={buttonClass}
                            disabled={mutation.isPending}
                            onClick={() => open({ op: 'link' })}
                          >
                            {tr('common.link_alerts')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </footer>
              )}
              {detailTab === 'handling' && (
                <footer className="workflow-detail-footer">
                  <p className="w-full text-xs text-[var(--text-secondary)]">
                    {handlingActionId && current.actions.some((a) => a.id === handlingActionId) && (
                      <>
                        {tr('safetyUi.handoverNumber', {
                          number: current.actions.findIndex((a) => a.id === handlingActionId) + 1,
                        })}{' '}
                        · {current.actions.find((a) => a.id === handlingActionId)?.description}
                      </>
                    )}
                  </p>
                  <div ref={setActionFooter} className="flex flex-wrap items-center gap-2" />
                  {!current.actions.length && (
                    <div>
                      {' '}
                      {safety && (
                        <div className="flex flex-wrap gap-2">
                          {current.status === 'CLOSED' ? (
                            <button
                              className={primaryClass}
                              disabled={mutation.isPending || !current.contractorId}
                              onClick={() => open({ op: 'reopen' })}
                            >
                              {tr('common.reopen_incident')}
                            </button>
                          ) : (
                            <>
                              <button
                                className={currentActions.length ? buttonClass : primaryClass}
                                disabled={mutation.isPending || !current.contractorId}
                                onClick={() => open({ op: 'assign' })}
                              >
                                {tr('incident_view.hand_over_to_contractor')}
                              </button>
                              <button
                                className={buttonClass}
                                disabled={mutation.isPending}
                                onClick={() => open({ op: 'link' })}
                              >
                                {tr('common.link_alerts')}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </footer>
              )}
            </>
          )}
        </section>
      </WorkflowSplit>
      {editor && (
        <Dialog
          title={titles[editor.op]}
          pending={mutation.isPending}
          onClose={() => {
            setEditor(undefined);
            setResultFile(undefined);
            p.onSourceConsumed?.();
          }}
          error={mutation.error ?? (editor.op !== 'create' ? detail.error : undefined)}
          reload={reload}
        >
          {editorBlocked && <p role="alert">{tr('safety_ux.action_no_longer_available')}</p>}
          <CommandForm
            pending={mutation.isPending}
            disabled={editorDisabled}
            label={
              editor.op === 'create'
                ? tr('common.create_incident')
                : editor.op === 'review'
                  ? tr('common.record_handling_outcome')
                  : titles[editor.op]
            }
            onSubmit={(form) => {
              if (editorDisabled) return;
              if (editor.op === 'create') {
                const input: Omit<CreateIncidentCommand, 'commandId'> = {
                  title: text(form, 'title'),
                  description: text(form, 'description'),
                  severity: text(form, 'severity') as IncidentSeverity,
                  occurredAt: new Date(text(form, 'occurredAt')).toISOString(),
                  zoneId: text(form, 'zoneId') || null,
                  alertIds: ids(form, 'alertIds'),
                  ...(ids(form, 'alertIds').length
                    ? {
                        contractorId: text(form, 'contractorId'),
                        workerIds: ids(form, 'workerIds'),
                        responsibilityReason: text(form, 'reason'),
                        initialAction: {
                          assignedTo: text(form, 'assignedTo'),
                          description: text(form, 'actionDescription'),
                          dueAt: deadline(form),
                        },
                      }
                    : {}),
                };
                mutation.mutate({
                  fingerprint: JSON.stringify(input),
                  run: (commandId, signal) =>
                    p.client.createIncident(p.token, p.siteId, { ...input, commandId }, { signal }),
                });
                return;
              }
              if (!current) return;
              if (editor.op === 'correct-responsibility')
                command('correct-responsibility', {
                  expectedVersion: current.version,
                  contractorId: text(form, 'contractorId'),
                  workerIds: ids(form, 'workerIds'),
                  reason: text(form, 'reason'),
                  assignedTo: text(form, 'assignedTo'),
                  description: text(form, 'description'),
                  dueAt: deadline(form),
                } as CorrectIncidentResponsibilityCommand);
              else if (editor.op === 'responsibility')
                command('responsibility', {
                  expectedVersion: current.version,
                  contractorId: text(form, 'contractorId'),
                  workerIds: ids(form, 'workerIds'),
                  reason: text(form, 'reason'),
                } as ConfirmIncidentResponsibilityCommand);
              else if (editor.op === 'transfer' && action)
                command(
                  'transfer',
                  {
                    expectedVersion: action.version,
                    assignedTo: text(form, 'assignedTo'),
                    reason: text(form, 'reason'),
                  } as TransferCorrectiveActionCommand,
                  action.id,
                );
              else if (editor.op === 'link')
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
              else if (action && editor.op === 'submit')
                command(
                  'submit',
                  {
                    expectedVersion: action.version,
                    resultDescription: text(form, 'resultDescription'),
                  } as SubmitSafetyResultCommand,
                  action.id,
                  resultFile,
                );
              else if (action && editor.op === 'review')
                command(
                  'review',
                  {
                    expectedVersion: action.version,
                    submissionId: editor.submissionId!,
                    decision: text(form, 'decision') as ReviewSubmissionCommand['decision'],
                    reason: text(form, 'reason'),
                  } as ReviewSubmissionCommand,
                  action.id,
                );
            }}
          >
            {editor.op === 'create' && (
              <>
                <Field name="title" label={tr('common.title')} required maxLength={200} />
                <Field
                  name="description"
                  label={tr('common.description')}
                  required
                  type="textarea"
                />
                <label className="block text-sm font-semibold">
                  {tr('common.severity')}
                  <SmartNativeSelect className={fieldClass} name="severity">
                    {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
                      <option key={s} value={s}>
                        {label(s)}
                      </option>
                    ))}
                  </SmartNativeSelect>
                </label>
                <Field
                  name="occurredAt"
                  label={tr('incident_view.occurred_at_local_time')}
                  type="datetime-local"
                  required
                  defaultValue={occurredDefault}
                />
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold">
                    {tr('common.optional_references')}
                  </summary>
                  <Field name="zoneId" label={tr('common.zone_id_optional')} />
                </details>
                <ConfirmedAlerts
                  p={p}
                  initialAlertId={p.initialAlertId}
                  onSelectionChange={setCreateAlertIds}
                />
                {createAlertIds.length > 0 && <ResponsibilityFields p={p} handover creating />}
                <p className="text-xs text-[var(--text-secondary)]">
                  {tr(
                    'incident_view.select_no_alerts_for_a_manual_incident_source_evidence_and_review_history_stay_int',
                  )}
                </p>
              </>
            )}
            {(editor.op === 'responsibility' || editor.op === 'correct-responsibility') &&
              current && (
                <ResponsibilityFields
                  p={p}
                  incident={current}
                  handover={editor.op === 'correct-responsibility'}
                />
              )}
            {editor.op === 'transfer' && current && (
              <>
                <Assignee
                  p={p}
                  role="CONTRACTOR_REPRESENTATIVE"
                  contractorId={current.contractorId ?? undefined}
                />
                <Field
                  name="reason"
                  label={tr('common.transfer_reason')}
                  type="textarea"
                  required
                  maxLength={2000}
                />
                <p className="text-sm">
                  {tr(
                    'incident_view.the_action_returns_to_assigned_earlier_submissions_and_reviews_are_preserved',
                  )}
                </p>
              </>
            )}
            {editor.op === 'link' && <ConfirmedAlerts p={p} />}
            {(editor.op === 'assign' || editor.op === 'reopen') && (
              <>
                {editor.op === 'reopen' && (
                  <Field
                    name="reason"
                    label={tr('common.reopening_reason')}
                    type="textarea"
                    required
                  />
                )}
                <Assignee
                  p={p}
                  role="CONTRACTOR_REPRESENTATIVE"
                  contractorId={current?.contractorId ?? undefined}
                />
                <Field
                  name="description"
                  label={tr('common.handling_request')}
                  type="textarea"
                  required
                />
                <Field
                  name="dueAt"
                  label={tr('incident_view.deadline_optional_local_time')}
                  type="datetime-local"
                />
              </>
            )}
            {editor.op === 'submit' && <ResultFields onFileChange={setResultFile} />}
            {editor.op === 'review' && (
              <>
                <label className="block text-sm font-semibold">
                  {tr('incident_view.review_decision')}
                  <SmartNativeSelect
                    className={fieldClass}
                    name="decision"
                    required
                    defaultValue={editor.decision ?? 'APPROVED'}
                  >
                    <option value="APPROVED">{tr('incident_view.verify_and_close_action')}</option>
                    <option value="REJECTED">{tr('incident_view.return_for_rework')}</option>
                  </SmartNativeSelect>
                </label>
                <Field
                  name="reason"
                  label={tr('common.recording_note')}
                  type="textarea"
                  required
                  maxLength={2000}
                />
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
  footer,
  selected,
  onSelect,
}: {
  footer?: HTMLElement | null;
  selected?: boolean;
  onSelect?: () => void;
  p: WorkflowProps;
  incident: IncidentDetailResponse;
  action: CorrectiveActionResponse;
  pending: boolean;
  checkedAt: number;
  command: (op: 'start', input: WithoutCommandId<VersionCommand>, actionId: string) => void;
  open: (editor: Editor) => void;
}) {
  useTranslation();

  const mine =
    !action.supersededAt &&
    hasRole(p, 'CONTRACTOR_REPRESENTATIVE') &&
    action.assignedTo === p.user.id;
  const waiting = action.supersededAt
      ? []
      : action.submissions.filter((s) => s.status === 'PENDING'),
    history = action.submissions.filter((s) => action.supersededAt || s.status !== 'PENDING');
  const result = (submission: CorrectiveActionResponse['submissions'][number]) => (
    <section
      key={submission.id}
      className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface-bone)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge value={submission.status} />
        <time className="text-xs text-[var(--text-secondary)]">
          {tr('common.submitted_value', { value1: date(submission.submittedAt) })}
        </time>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{submission.resultDescription}</p>
      <p className="text-xs">
        {tr('common.reported_by_value', {
          value1: submission.submittedByName ?? tr('common.account_unavailable'),
        })}
      </p>
      {submission.reviewedBy && (
        <p className="text-xs">
          {tr('common.recorded_by_value', {
            value1: submission.reviewedByName ?? tr('common.account_unavailable'),
          })}
        </p>
      )}
      {submission.reviewNote && (
        <p className="text-sm">
          {tr('incident_view.review_value_value', {
            value1: submission.reviewNote,
            value2: date(submission.reviewedAt),
          })}
        </p>
      )}
      {submission.evidence && (
        <Evidence p={p} type="incidents" id={incident.id} evidenceId={submission.evidence.id} />
      )}
      {!action.supersededAt &&
        hasRole(p, 'SAFETY_OFFICER') &&
        action.status === 'SUBMITTED' &&
        incident.status !== 'CLOSED' &&
        submission.status === 'PENDING' &&
        submission.submittedBy !== p.user.id && (
          <ActionControl footer={footer}>
            <>
              <button
                className={primaryClass}
                disabled={pending}
                onClick={() =>
                  open({
                    op: 'review',
                    actionId: action.id,
                    submissionId: submission.id,
                    decision: 'APPROVED',
                  })
                }
              >
                {tr('safetyUi.approveResult')}
              </button>
              <button
                className={buttonClass}
                disabled={pending}
                onClick={() =>
                  open({
                    op: 'review',
                    actionId: action.id,
                    submissionId: submission.id,
                    decision: 'REJECTED',
                  })
                }
              >
                {tr('safetyUi.returnResult')}
              </button>
            </>
          </ActionControl>
        )}
    </section>
  );
  return (
    <article
      id={'action-' + action.id}
      className={cardClass + (selected ? ' ring-1 ring-[var(--accent)]' : '')}
    >
      <p className="text-xs font-semibold text-[var(--text-secondary)]">
        {tr('safetyUi.handoverNumber', {
          number: incident.actions.findIndex((item) => item.id === action.id) + 1,
        })}
      </p>
      {action.supersededAt && (
        <p className="text-sm font-semibold">
          {tr('common.superseded_handover')} {date(action.supersededAt)}
          <br />
          {action.supersededReason}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h4 className="min-w-0 break-words font-semibold">
          <button type="button" className="text-left" aria-pressed={selected} onClick={onSelect}>
            {action.description}
          </button>
        </h4>
        <StatusBadge value={action.status} />
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        {tr('incident_view.value_deadline_value', {
          value1: action.assignedToName ?? tr('common.account_unavailable'),
          value2: date(action.dueAt),
        })}
      </p>
      {action.dueAt &&
        new Date(action.dueAt).getTime() < checkedAt &&
        action.status !== 'CLOSED' && (
          <p className="text-xs font-semibold text-[var(--semantic-red-text)]">
            {tr('common.past_deadline')}
          </p>
        )}
      {!action.supersededAt &&
        hasRole(p, 'SAFETY_OFFICER') &&
        incident.status !== 'CLOSED' &&
        action.status !== 'CLOSED' && (
          <div className="space-y-2">
            <ActionControl footer={footer}>
              <button
                className={buttonClass}
                disabled={pending || !incident.contractorId || waiting.length > 0}
                onClick={() => open({ op: 'transfer', actionId: action.id })}
              >
                {tr('common.transfer_action')}
              </button>
            </ActionControl>
            {waiting.length > 0 && (
              <p className="text-xs">
                {tr('incident_view.review_the_pending_result_before_transferring_this_action')}
              </p>
            )}
          </div>
        )}
      {mine && action.status === 'ASSIGNED' && (
        <ActionControl footer={footer}>
          <button
            className={primaryClass}
            disabled={pending}
            onClick={() => command('start', { expectedVersion: action.version }, action.id)}
          >
            {tr('common.start_handling')}
          </button>
        </ActionControl>
      )}
      {mine && action.status === 'IN_PROGRESS' && (
        <ActionControl footer={footer}>
          <button
            className={primaryClass}
            disabled={pending}
            onClick={() => open({ op: 'submit', actionId: action.id })}
          >
            {tr('common.report_handling_outcome')}
          </button>
        </ActionControl>
      )}
      {waiting.length > 0 && (
        <div className="space-y-3">
          <h5 className="text-sm font-bold">{tr('common.awaiting_safety_recording')}</h5>
          {waiting.map(result)}
        </div>
      )}
      {history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold">
            {tr('common.submission_history_value', { value1: history.length })}
          </summary>
          <div className="mt-3 space-y-3">{history.map(result)}</div>
        </details>
      )}
    </article>
  );
}

function ActionControl({ footer, children }: { footer?: HTMLElement | null; children: ReactNode }) {
  return footer ? createPortal(children, footer) : children;
}

function SourceAlert({
  position,
  p,
  incidentId,
  alertId,
}: {
  position: number;
  p: WorkflowProps;
  incidentId: string;
  alertId: string;
}) {
  useTranslation();

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
        {tr('safetyUi.sourceAlert', { number: position })}
      </button>
      {open && (
        <>
          <RequestError error={query.error} retry={() => void query.refetch()} />
          {query.isPending && <p>{tr('common.loading_source_evidence')}</p>}
          {query.data && (
            <>
              <p>
                {tr('incident_view.value_value_value_observations', {
                  value1: label(query.data.alertType),
                  value2: label(query.data.status),
                  value3: query.data.detectionCount,
                })}
              </p>
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
  useTranslation();

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
      {query.data && <BlobImage blob={query.data} alt={tr('common.original_camera_observation')} />}
    </>
  );
}

function ResponsibilityFields({
  p,
  incident,
  handover = false,
  creating = false,
}: {
  p: WorkflowProps;
  incident?: IncidentDetailResponse;
  handover?: boolean;
  creating?: boolean;
}) {
  useTranslation();

  const [contractorId, setContractorId] = useState(incident?.contractorId ?? '');
  const [contractorOffset, setContractorOffset] = useState(0),
    [workerOffset, setWorkerOffset] = useState(0);
  const [chosen, setChosen] = useState<string[]>(incident?.workerIds ?? []);
  const contractors = useQuery({
    queryKey: ['safety-workflow', p.apiUrl, p.scope, p.siteId, 'contractors', contractorOffset],
    queryFn: ({ signal }) =>
      p.client.listSafetyContractors(
        p.token,
        p.siteId,
        { offset: contractorOffset, limit: 20 },
        { signal },
      ),
    retry: false,
  });
  const workers = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'contractor-workers',
      contractorId,
      workerOffset,
    ],
    queryFn: ({ signal }) =>
      p.client.listIncidentWorkers(
        p.token,
        p.siteId,
        contractorId,
        { offset: workerOffset, limit: 20 },
        { signal },
      ),
    enabled: !!contractorId,
    retry: false,
  });
  return (
    <>
      <label className="block text-sm font-semibold">
        {tr('common.responsible_contractor')}
        <SmartNativeSelect
          className={fieldClass}
          name="contractorId"
          required
          value={contractorId}
          onChange={(e) => {
            setContractorId(e.target.value);
            setChosen([]);
            setWorkerOffset(0);
          }}
        >
          <option value="">
            {tr('incident_view.choose_a_contractor_participating_in_this_site')}
          </option>
          {contractorId && !contractors.data?.items.some((c) => c.id === contractorId) && (
            <option value={contractorId}>{tr('common.current_confirmed_contractor')}</option>
          )}
          {contractors.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SmartNativeSelect>
      </label>
      {contractors.isPending && <p>{tr('common.loading_contractors')}</p>}
      <RequestError error={contractors.error} retry={() => void contractors.refetch()} />
      {contractors.data && contractors.data.total > 20 && (
        <Pager
          offset={contractorOffset}
          total={contractors.data.total}
          onChange={setContractorOffset}
        />
      )}
      {contractorId && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">
            {tr('incident_view.confirmed_worker_subjects_optional')}
          </legend>
          <p className="text-sm">
            {tr(
              'incident_view.select_only_workers_you_have_verified_leave_empty_when_identity_is_unknown_camera',
            )}
          </p>
          {workers.isPending && <p>{tr('common.loading_workers')}</p>}
          <RequestError error={workers.error} retry={() => void workers.refetch()} />
          {workers.data?.items.map((w) => (
            <label key={w.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.includes(w.id)}
                onChange={(e) =>
                  setChosen((old) =>
                    e.target.checked ? [...old, w.id] : old.filter((id) => id !== w.id),
                  )
                }
              />
              {w.displayName} · {w.externalId}
            </label>
          ))}
          {workers.data && !workers.data.total && (
            <p>
              {tr(
                'incident_view.no_active_workers_registered_for_this_contractor_identity_may_remain_unknown',
              )}
            </p>
          )}
          <p className="text-xs">{tr('common.value_selected', { value1: chosen.length })}</p>
          {workers.data && workers.data.total > 20 && (
            <Pager offset={workerOffset} total={workers.data.total} onChange={setWorkerOffset} />
          )}
        </fieldset>
      )}
      <input type="hidden" name="workerIds" value={chosen.join(',')} />
      <Field
        name="reason"
        label={
          handover && !creating ? tr('common.correction_reason') : tr('common.verification_reason')
        }
        type="textarea"
        required
        maxLength={2000}
      />
      {handover && (
        <>
          <Assignee
            key={contractorId}
            p={p}
            role="CONTRACTOR_REPRESENTATIVE"
            contractorId={contractorId || undefined}
          />
          <Field
            name={creating ? 'actionDescription' : 'description'}
            label={tr('common.handling_request')}
            type="textarea"
            required
          />
          <Field
            name="dueAt"
            label={tr('incident_view.deadline_optional_local_time')}
            type="datetime-local"
          />
          {!creating && (
            <p className="text-sm">
              {tr(
                'incident_view.previous_handovers_and_reports_are_preserved_for_safety_the_previous_contractor_lo',
              )}
            </p>
          )}
        </>
      )}
      <p className="text-sm">
        {tr(
          'incident_view.explain_how_you_confirmed_the_contractor_and_any_worker_identity_do_not_infer_the',
        )}
      </p>
    </>
  );
}
