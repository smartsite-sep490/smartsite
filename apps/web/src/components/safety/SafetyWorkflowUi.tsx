import { localizedError } from '../../i18n/messages';
import { translate as tr } from '../../i18n';
import { useTranslation } from 'react-i18next';
import {
  type WorkflowProps,
  fieldClass,
  buttonClass,
  primaryClass,
  cardClass,
  date,
  label,
  formValues,
  photo,
} from './safety-workflow';
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, type SafetyAuditResponse } from '@smartsite/api-client';
export function Field({
  name,
  label: caption,
  required = false,
  type = 'text',
  defaultValue,
  maxLength = 10000,
}: {
  name: string;
  label: string;
  required?: boolean;
  type?: string;
  defaultValue?: string;
  maxLength?: number;
}) {
  useTranslation();

  return (
    <label className="block text-sm font-semibold">
      {caption}
      {type === 'textarea' ? (
        <textarea
          className={fieldClass + ' min-h-28 resize-y'}
          rows={4}
          name={name}
          required={required}
          maxLength={maxLength}
          defaultValue={defaultValue}
        />
      ) : (
        <input
          className={fieldClass}
          name={name}
          type={type}
          required={required}
          maxLength={maxLength}
          defaultValue={defaultValue}
        />
      )}
    </label>
  );
}
export function ResultFields({ onFileChange }: { onFileChange?: (file?: File) => void } = {}) {
  useTranslation();

  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>(),
    [error, setError] = useState<unknown>();
  return (
    <>
      <Field
        name="resultDescription"
        label={tr('common.result_description')}
        type="textarea"
        required
      />
      <label className="block text-sm font-semibold">
        {tr('safety_workflow_ui.photo_optional_jpeg_max_1_mib')}
        <input
          ref={input}
          className={fieldClass}
          type="file"
          name="file"
          accept="image/jpeg"
          onChange={(e) => {
            try {
              const form = new FormData();
              const next = e.currentTarget.files?.[0];
              if (!next) return;
              if (next) form.set('file', next);
              const accepted = photo(form);
              setFile(accepted);
              onFileChange?.(accepted);
              setError(undefined);
            } catch (error) {
              e.currentTarget.value = '';
              setError(error);
            }
          }}
        />
      </label>
      <RequestError error={error} />
      {file && (
        <div className="space-y-2 rounded-lg bg-[var(--surface-bone)] p-3">
          <p className="break-words text-sm">
            {tr('safety_workflow_ui.value_value_kib', {
              value1: file.name,
              value2: (file.size / 1024).toFixed(1),
            })}
          </p>
          <BlobImage blob={file} alt={tr('common.selected_result_photo')} />
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              if (input.current) input.current.value = '';
              setFile(undefined);
              onFileChange?.(undefined);
              setError(undefined);
            }}
          >
            {tr('common.remove_photo')}
          </button>
        </div>
      )}
    </>
  );
}
export function RequestError({ error, retry }: { error: unknown; retry?: () => void }) {
  useTranslation();

  if (!error) return null;
  const conflict = error instanceof ApiError && error.status === 409;
  const message =
    error instanceof ApiError
      ? error.status === 403
          ? tr('safety_workflow_ui.this_account_does_not_have_access')
          : error.status === 503 || error.status === 404
            ? tr('safety_workflow_ui.evidence_or_service_unavailable')
            : error.message
      : error instanceof Error
        ? error.message
        : tr('common.request_failed');
  return (
    <div className="space-y-3 rounded-lg border border-red-200 bg-[var(--semantic-red-bg)] p-3 text-sm text-[var(--semantic-red-text)]">
      <p role="alert">
        {localizedError(message)}
        {conflict && (
          <span className="block mt-1">
            {tr('safety_workflow_ui.data_changed_reload_and_review_the_current_version_before_submitting_again')}
          </span>
        )}
      </p>
      {retry && (
        <button className={buttonClass} type="button" onClick={retry}>
          {conflict ? tr('common.reload_data') : tr('common.retry')}
        </button>
      )}
    </div>
  );
}
export function StatusBadge({ value, text: caption }: { value: string; text?: string }) {
  useTranslation();

  const tone = ['VERIFIED', 'APPROVED', 'ACCEPTED', 'PASS'].includes(value)
    ? 'bg-[var(--semantic-green-bg)] text-[var(--semantic-green-text)]'
    : ['REJECTED', 'CONFIRMED', 'CRITICAL', 'HIGH', 'FAIL'].includes(value)
      ? 'bg-[var(--semantic-red-bg)] text-[var(--semantic-red-text)]'
      : ['IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'NEEDS_MORE_EVIDENCE'].includes(value)
        ? 'bg-[var(--semantic-blue-bg)] text-[var(--semantic-blue-text)]'
        : ['CLOSED', 'CANCELLED', 'DISMISSED', 'LOW'].includes(value)
          ? 'bg-[var(--surface-bone)] text-[var(--text-secondary)]'
          : 'bg-[var(--semantic-amber-bg)] text-[var(--semantic-amber-text)]';
  return (
    <span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ' + tone}>
      {caption ?? label(value)}
    </span>
  );
}
export function TechnicalDetails({ children }: { children: ReactNode }) {
  useTranslation();

  return (
    <details className="text-xs text-[var(--text-secondary)]">
      <summary className="cursor-pointer py-2 font-semibold">
        {tr('common.technical_details')}
      </summary>
      <div className="space-y-2 break-all pt-2">{children}</div>
    </details>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  pending = false,
  error,
  reload,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  pending?: boolean;
  error?: unknown;
  reload?: () => void;
}) {
  useTranslation();

  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (!pending) onClose();
      }}
      onKeyDown={(e) => {
        if (e.defaultPrevented) return;
        if (e.key === 'Tab') {
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              'button, input, select, textarea, a[href], summary, [tabindex]',
            ),
          ).filter(
            (control) =>
              !control.matches(':disabled, [hidden]') &&
              control.tabIndex >= 0 &&
              !control.closest('details:not([open]) > :not(summary)'),
          );
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (
            first &&
            last &&
            ((e.shiftKey && document.activeElement === first) ||
              (!e.shiftKey && document.activeElement === last))
          ) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          if (!pending) onClose();
        }
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-[var(--border)] bg-white p-0 text-[var(--text-body)] shadow-xl backdrop:bg-black/40"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[var(--border)] bg-white p-5">
        <h2 id={id} className="text-xl font-bold text-[var(--text-heading)]">
          {title}
        </h2>
        <button type="button" className={buttonClass} disabled={pending} onClick={onClose}>
          {tr('common.cancel')}
        </button>
      </div>
      <div className="space-y-4 p-5">
        <RequestError error={error} retry={reload} />
        {children}
      </div>
    </dialog>
  );
}
export function Assignee({
  p,
  role,
  value,
  onChange,
  contractorId,
}: {
  p: WorkflowProps;
  role: 'SAFETY_OFFICER' | 'CONTRACTOR_REPRESENTATIVE';
  value?: string;
  onChange?: (value: string) => void;
  contractorId?: string;
}) {
  useTranslation();

  const [offset, setOffset] = useState(0);
  const [choice, setChoice] = useState({ id: '', name: '' });
  const selected = onChange ? (value ?? '') : choice.id;
  const query = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'assignees',
      role,
      contractorId ?? '',
      offset,
    ],
    queryFn: ({ signal }) =>
      p.client.listSafetyAssignees(
        p.token,
        p.siteId,
        role,
        { offset, limit: 20, ...(contractorId ? { contractorId } : {}) },
        { signal },
      ),
    retry: false,
  });
  return (
    <div>
      <label className="block text-sm font-semibold">
        {onChange ? tr('common.assigned_to') : tr('common.assignee')}
        <select
          className={fieldClass}
          name={onChange ? undefined : 'assignedTo'}
          required={!onChange}
          value={selected}
          onChange={(e) => {
            const id = e.target.value;
            setChoice({
              id,
              name: e.target.selectedOptions[0]?.textContent ?? tr('common.selected_officer'),
            });
            onChange?.(id);
          }}
        >
          <option value="">
            {onChange
              ? tr('common.all_assignees')
              : role === 'CONTRACTOR_REPRESENTATIVE'
                ? tr('safety_workflow_ui.choose_a_contractor_representative')
                : tr('safety_workflow_ui.choose_an_active_officer')}
          </option>
          {selected && !query.data?.items.some((u) => u.id === selected) && (
            <option value={selected}>
              {choice.id === selected ? choice.name : tr('common.selected_officer')}
            </option>
          )}
          {query.data?.items.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </select>
      </label>
      {query.isPending && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {tr('common.loading_assignees')}
        </p>
      )}
      <RequestError error={query.error} retry={() => void query.refetch()} />
      {query.data && query.data.total > 20 && (
        <div className="mt-2 flex gap-2">
          <button
            className={buttonClass}
            type="button"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            {tr('common.previous_assignees')}
          </button>
          <button
            className={buttonClass}
            type="button"
            disabled={offset + 20 >= query.data.total}
            onClick={() => setOffset(offset + 20)}
          >
            {tr('common.more_assignees')}
          </button>
        </div>
      )}
    </div>
  );
}
export function OfficerName({
  p,
  role,
  id,
  contractorId,
}: {
  p: WorkflowProps;
  role: 'SAFETY_OFFICER' | 'CONTRACTOR_REPRESENTATIVE';
  id: string;
  contractorId?: string;
}) {
  useTranslation();

  const allowed = p.user.roleAssignments.some(
    (r) =>
      (r.role === 'ADMIN' && r.siteId === null) ||
      (r.siteId === p.siteId &&
        r.role === (role === 'SAFETY_OFFICER' ? 'SITE_MANAGER' : 'SAFETY_OFFICER')),
  );
  const query = useQuery({
    queryKey: [
      'safety-workflow',
      p.apiUrl,
      p.scope,
      p.siteId,
      'assignees',
      role,
      contractorId ?? '',
      0,
    ],
    queryFn: ({ signal }) =>
      p.client.listSafetyAssignees(
        p.token,
        p.siteId,
        role,
        { offset: 0, limit: 20, ...(contractorId ? { contractorId } : {}) },
        { signal },
      ),
    enabled: allowed && id !== p.user.id,
    retry: false,
  });
  return (
    <>
      {id === p.user.id
        ? tr('common.you')
        : (query.data?.items.find((u) => u.id === id)?.displayName ??
          tr('safety_workflow_ui.assigned_account_historical_or_unavailable'))}
    </>
  );
}
export function Audit({ items }: { items: SafetyAuditResponse[] }) {
  useTranslation();

  return (
    <section className={cardClass}>
      <h3 className="font-bold">{tr('common.activity_history')}</h3>
      {!items.length && (
        <p className="text-sm text-[var(--text-secondary)]">{tr('common.no_activity_yet')}</p>
      )}
      <ol className="space-y-4">
        {items.map((item) => (
          <li key={item.id} className="border-l-2 border-[var(--accent)] pl-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>
                {item.resourceType === 'INCIDENT'
                  ? ((
                      {
                        assign: tr('common.case_handed_over'),
                        start: tr('common.handling_started'),
                        submit: tr('common.handling_outcome_reported'),
                        review:
                          item.changes.decision === 'REJECTED'
                            ? tr('common.result_returned_legacy')
                            : tr('common.handling_outcome_recorded'),
                        'correct-responsibility': tr('common.responsibility_corrected'),
                      } as Record<string, string>
                    )[item.action] ?? label(item.action))
                  : item.resourceType === 'CHECKLIST'
                    ? ((
                        {
                          create: tr('labels.CHECKLIST_ASSIGNED'),
                          start: tr('safety_workspace.checklist_started'),
                          submit: tr('safety_workspace.checklist_reported'),
                          review:
                            item.changes.decision === 'RETURNED'
                              ? tr('labels.CHECKLIST_RETURNED')
                              : tr('labels.CHECKLIST_RECORDED'),
                          cancel: tr('safety_workspace.checklist_cancelled'),
                        } as Record<string, string>
                      )[item.action] ?? label(item.action))
                    : label(item.action)}
              </strong>
              <time className="text-xs text-[var(--text-secondary)]">{date(item.occurredAt)}</time>
            </div>
            <p className="mt-1">
              {tr('common.by_value', {
                value1: item.actorName ?? tr('common.account_unavailable'),
              })}
            </p>
            {typeof item.changes.assignedToName === 'string' && (
              <p>{tr('common.recipient_value', { value1: item.changes.assignedToName })}</p>
            )}
            {typeof item.changes.contractorName === 'string' && (
              <p>{tr('common.contractor_value', { value1: item.changes.contractorName })}</p>
            )}
            {item.reason && <p className="mt-2 whitespace-pre-wrap break-words">{item.reason}</p>}
            {typeof item.changes.resultDescription === 'string' && (
              <p className="mt-2 break-words">{item.changes.resultDescription}</p>
            )}
            {typeof item.changes.resultSummary === 'string' && (
              <p className="mt-2 break-words">{item.changes.resultSummary}</p>
            )}
            <TechnicalDetails>
              {tr('common.actor_value', { value1: item.actorId })}
            </TechnicalDetails>
          </li>
        ))}
      </ol>
    </section>
  );
}
export function Pager({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  useTranslation();

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-[var(--text-secondary)]">
      <button
        className={buttonClass}
        type="button"
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - 20))}
      >
        {tr('common.previous')}
      </button>
      <span>
        {tr('common.value_value_of_value', {
          value1: total ? offset + 1 : 0,
          value2: Math.min(offset + 20, total),
          value3: total,
        })}
      </span>
      <button
        className={buttonClass}
        type="button"
        disabled={offset + 20 >= total}
        onClick={() => onChange(offset + 20)}
      >
        {tr('common.next')}
      </button>
    </div>
  );
}
export function Evidence({
  p,
  type,
  id,
  evidenceId,
}: {
  p: WorkflowProps;
  type: 'incidents' | 'safety-tasks';
  id: string;
  evidenceId: string;
}) {
  useTranslation();

  const query = useQuery({
    queryKey: ['safety-workflow', p.apiUrl, p.scope, p.siteId, type, id, 'evidence', evidenceId],
    queryFn: ({ signal }) =>
      p.client.getWorkflowEvidence(p.token, p.siteId, type, id, evidenceId, { signal }),
    retry: false,
  });
  return (
    <>
      <RequestError error={query.error} retry={() => void query.refetch()} />
      {query.isPending && (
        <p className="text-sm text-[var(--text-secondary)]">{tr('common.loading_photo')}</p>
      )}
      {query.data && (
        <BlobImage blob={query.data} alt={tr('common.submitted_corrective_evidence')} />
      )}
    </>
  );
}
export function BlobImage({ blob, alt }: { blob: Blob; alt: string }) {
  useTranslation();

  const ref = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const image = ref.current;
    if (!image) return;
    const url = URL.createObjectURL(blob);
    image.src = url;
    return () => {
      image.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [blob]);
  return (
    <img
      ref={ref}
      className="max-h-80 max-w-full rounded-lg border border-[var(--border)] object-contain"
      alt={alt}
    />
  );
}
export function CommandForm({
  children,
  onSubmit,
  pending,
  label: caption,
}: {
  children: ReactNode;
  onSubmit: (form: FormData) => void;
  pending: boolean;
  label: string;
}) {
  useTranslation();

  const [error, setError] = useState<unknown>();
  return (
    <form
      onSubmit={(e) => {
        const form = formValues(e);
        try {
          onSubmit(form);
          setError(undefined);
        } catch (error) {
          setError(error);
        }
      }}
    >
      <fieldset className="space-y-4" disabled={pending}>
        {children}
        <div className="border-t border-[var(--border)] pt-4">
          <button className={primaryClass} type="submit">
            {pending ? tr('common.saving') : caption}
          </button>
        </div>
      </fieldset>
      <RequestError error={error} />
    </form>
  );
}
export function ConfirmedAlerts({
  p,
  initialAlertId,
}: {
  p: WorkflowProps;
  initialAlertId?: string;
}) {
  useTranslation();

  const [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<string[]>(initialAlertId ? [initialAlertId] : []);
  const query = useQuery({
    queryKey: ['safety-workflow', p.apiUrl, p.scope, p.siteId, 'confirmed-alerts', offset],
    queryFn: ({ signal }) =>
      p.client.listSafetyAlerts(
        p.token,
        p.siteId,
        { offset, limit: 20, status: 'CONFIRMED' },
        { signal },
      ),
    retry: false,
  });
  const linkedIds =
    query.data?.items.filter((alert) => alert.incidentId).map((alert) => alert.id) ?? [];
  if (selected.some((id) => linkedIds.includes(id)))
    setSelected(selected.filter((id) => !linkedIds.includes(id)));
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold">
        {tr('common.confirmed_alerts_optional')}
      </legend>
      {selected.map((id) => (
        <input key={id} type="hidden" name="alertIds" value={id} />
      ))}
      {selected.map((id) => (
        <button
          key={id}
          className={buttonClass}
          type="button"
          onClick={() => setSelected(selected.filter((value) => value !== id))}
        >
          {tr('safety_workflow_ui.remove_selected_alert_value', { value1: id.slice(0, 8) })}
        </button>
      ))}
      {query.isPending && <p>{tr('common.loading_confirmed_alerts')}</p>}
      <RequestError error={query.error} retry={() => void query.refetch()} />
      {query.data?.items
        .filter((a) => !a.incidentId)
        .map((alert) => (
          <label
            className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 text-sm"
            key={alert.id}
          >
            <input
              type="checkbox"
              checked={selected.includes(alert.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, alert.id]
                    : selected.filter((id) => id !== alert.id),
                )
              }
            />
            <span>
              {label(alert.candidateSubtype)} · {date(alert.lastDetectedAt)} ·{' '}
              {alert.id.slice(0, 8)}
            </span>
          </label>
        ))}
      {query.data && !query.data.items.some((a) => !a.incidentId) && (
        <p className="text-sm text-[var(--text-secondary)]">
          {tr(
            'safety_workflow_ui.no_unlinked_confirmed_alert_on_this_page_you_can_create_a_manual_incident',
          )}
        </p>
      )}
      {query.data && query.data.total > 20 && (
        <Pager offset={offset} total={query.data.total} onChange={setOffset} />
      )}
    </fieldset>
  );
}
