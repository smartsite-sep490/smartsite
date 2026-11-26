import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  SaveWorkerOnboardingDraftCommand,
  SmartSiteManagementClient,
  WorkerDocumentKind,
  WorkerOnboardingBatchResult,
  WorkerOnboardingDraft,
} from '@smartsite/api-client';
import { useAuth, useCurrentUser, useManagementClient } from '../../../features/auth/auth-session';
import { translate as tr, uiLanguage } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { ActionDrawer } from '../../shared/ActionDrawer';
import { WorksitePicker } from '../../shared/WorksitePicker';
import { SmartDatePicker } from '../../ui';
import { SmartNativeSelect } from '../../ui/SmartNativeSelect';
import { loadAllPages } from '../load-all-pages';
import { BatchDocumentAnalysis } from './BatchDocumentAnalysis';
import {
  DocumentAttachmentInput,
  DocumentFilePreview,
  DocumentRequestError,
  documentButton,
  documentField,
  documentPrimaryButton,
} from './DocumentAttachmentInput';
import { documentKinds } from './worker-document-files';

export function WorkerOnboardingView({ apiUrl }: { apiUrl: string }) {
  useTranslation();
  const { accessToken } = useAuth();
  const profile = useCurrentUser(apiUrl);
  const client = useManagementClient(apiUrl);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const siteIds =
    profile.data?.roleAssignments
      .filter((role) => role.role === 'CONTRACTOR_REPRESENTATIVE')
      .map((role) => role.siteId) ?? [];
  const allowed = !!accessToken && !profile.data?.mustChangePassword && siteIds.length > 0;
  const scope = apiUrl + ':' + (profile.data?.id ?? '');
  const sites = useQuery({
    queryKey: ['worker-onboarding', scope, 'sites'],
    enabled: allowed,
    queryFn: ({ signal }) =>
      loadAllPages((options) => client.listSites(accessToken!, options), signal),
  });
  const choices = sites.data?.items.filter((site) => siteIds.includes(site.id)) ?? [];
  const siteId = choices.some((site) => site.id === selectedSiteId)
    ? selectedSiteId
    : (choices[0]?.id ?? '');

  if (profile.isError || sites.isError) {
    const query = profile.isError ? profile : sites;
    return <DocumentRequestError error={query.error} reload={() => void query.refetch()} />;
  }
  if (profile.isPending || (allowed && sites.isPending)) {
    return <p role="status">{tr('common.loading')}</p>;
  }
  if (!allowed) return <p role="alert">{tr('errors.forbidden')}</p>;

  return (
    <section className="mx-auto max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {tr('workerIntake.title')}
        </h1>
        {siteId && (
          <WorksitePicker
            id="worker-intake-site-select"
            value={siteId}
            sites={choices}
            onChange={setSelectedSiteId}
          />
        )}
      </header>
      {siteId ? (
        <IntakeContractor
          key={scope + ':' + siteId}
          client={client}
          token={accessToken!}
          siteId={siteId}
          scope={scope}
        />
      ) : (
        <p role="status">{tr('worker_onboarding_view.no_assigned_sites_are_available')}</p>
      )}
    </section>
  );
}

type IntakeScope = {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  scope: string;
};

function IntakeContractor(p: IntakeScope) {
  const [selected, setSelected] = useState('');
  const options = useQuery({
    queryKey: ['worker-onboarding', p.scope, p.siteId, 'contractors'],
    queryFn: () => p.client.contractorWorkerAccountOptions(p.token, p.siteId),
  });
  const contractors = options.data?.contractors ?? [];
  const contractorId = contractors.some((item) => item.id === selected)
    ? selected
    : (contractors[0]?.id ?? '');
  if (options.isPending) return <p role="status">{tr('common.loading_your_contractors')}</p>;
  if (options.isError) {
    return <DocumentRequestError error={options.error} reload={() => void options.refetch()} />;
  }
  if (!contractorId) {
    return (
      <p role="status">
        {tr(
          'worker_onboarding_view.no_active_contractor_participation_is_assigned_to_you_at_this_site_contact_your_si',
        )}
      </p>
    );
  }
  return (
    <IntakeTable
      key={contractorId}
      {...p}
      contractorId={contractorId}
      contractors={contractors}
      onContractorChange={setSelected}
    />
  );
}

function batchError(code: string | undefined) {
  if (code === 'CONFLICT' || code === 'USERNAME_CONFLICT' || code === 'EMAIL_CONFLICT')
    return tr('errors.conflict');
  if (code === 'FORBIDDEN') return tr('errors.forbidden');
  if (code === 'NOT_FOUND') return tr('errors.notFound');
  if (code === 'VALIDATION_FAILED' || code === 'BAD_REQUEST') return tr('errors.validation');
  return tr('errors.unexpected');
}

function IntakeTable(
  p: IntakeScope & {
    contractorId: string;
    contractors: { id: string; name: string }[];
    onContractorChange: (id: string) => void;
  },
) {
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, WorkerOnboardingBatchResult>>({});
  const [editing, setEditing] = useState<{ formId: string; draft?: WorkerOnboardingDraft }>();
  const cache = useQueryClient();
  const key = ['worker-intake-drafts', p.scope, p.siteId, p.contractorId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => p.client.listWorkerOnboardingDrafts(p.token, p.siteId, p.contractorId),
  });
  const rows = query.data?.items ?? [];
  const chosen = rows.filter((row) => selected.includes(row.id));
  const provisionable = chosen.filter((row) => row.canProvision);
  const sendable = chosen.filter(
    (row) => row.canSubmit && row.workerId && row.workerVersion !== null,
  );
  const selectedAll = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  const batch = useMutation({
    mutationFn: async (operation: 'provision' | 'send') => {
      const attempted = operation === 'provision' ? provisionable : sendable;
      const rows =
        operation === 'provision'
          ? attempted.map(({ id, version }) => ({ id, version }))
          : attempted.map(({ workerId, workerVersion }) => ({
              id: workerId!,
              version: workerVersion!,
            }));
      const items: WorkerOnboardingBatchResult[] = [];
      for (let offset = 0; offset < rows.length; offset += 50) {
        const batchRows = rows.slice(offset, offset + 50);
        try {
          const result =
            operation === 'provision'
              ? await p.client.provisionWorkerOnboardingBatch(
                  p.token,
                  p.siteId,
                  p.contractorId,
                  batchRows,
                )
              : await p.client.sendWorkerDocumentsBatch(
                  p.token,
                  p.siteId,
                  p.contractorId,
                  batchRows,
                );
          items.push(...result.items);
        } catch (error) {
          if (!items.length) throw error;
          items.push(...rows.slice(offset).map(({ id }) => ({ id, status: 'FAILED' as const })));
          break;
        }
      }
      return { items, attempted };
    },
    onSuccess: ({ items, attempted }, operation) => {
      const next: Record<string, WorkerOnboardingBatchResult> = {};
      for (const row of attempted) {
        const item = items.find(
          ({ id }) => id === (operation === 'provision' ? row.id : row.workerId),
        );
        if (item) next[row.id] = item;
      }
      setResults((current) => ({ ...current, ...next }));
      setSelected((current) => current.filter((id) => next[id]?.status !== 'SUCCEEDED'));
      void cache.invalidateQueries({ queryKey: key });
      void cache.invalidateQueries({ queryKey: ['worker-documents'] });
      void cache.invalidateQueries({ queryKey: ['worker-document-queue'] });
      void cache.invalidateQueries({ queryKey: ['worker-roster'] });
    },
  });
  const openNew = () => setEditing({ formId: crypto.randomUUID() });
  const close = () => setEditing(undefined);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid w-full max-w-xs gap-1 text-sm font-medium text-slate-700">
          {tr('common.contractor')}
          <SmartNativeSelect
            className={documentField}
            value={p.contractorId}
            onChange={(event) => p.onContractorChange(event.target.value)}
          >
            {p.contractors.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SmartNativeSelect>
        </label>
        <div className="flex flex-wrap gap-2">
          <Link
            className={documentButton}
            to={'/worker-documents?' + new URLSearchParams({ siteId: p.siteId })}
          >
            {tr('workerIntake.recordTitle')}
          </Link>
          <button
            type="button"
            className={documentPrimaryButton}
            disabled={batch.isPending}
            onClick={openNew}
          >
            {tr('workerIntake.add')}
          </button>
        </div>
      </div>
      <div className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-live="polite" className="mx-1 text-sm text-slate-600">
            {tr('workerIntake.selected', { count: chosen.length })}
          </span>
          <button
            type="button"
            className={documentButton}
            disabled={batch.isPending || !provisionable.length}
            onClick={() => batch.mutate('provision')}
          >
            {tr('workerIntake.provisionCount', { count: provisionable.length })}
          </button>
          <button
            type="button"
            className={documentButton + ' ml-auto'}
            disabled={batch.isPending || !sendable.length}
            onClick={() => batch.mutate('send')}
          >
            {tr('workerIntake.sendCount', { count: sendable.length })}
          </button>
          <BatchDocumentAnalysis
            client={p.client}
            token={p.token}
            siteId={p.siteId}
            workers={chosen.flatMap((row) =>
              row.workerId
                ? [{ id: row.workerId, name: row.displayName || row.workerCode || row.username }]
                : [],
            )}
            disabled={batch.isPending}
          />
        </div>
        {batch.isPending && (
          <p role="status" className="text-sm text-slate-600">
            {tr('common.loading')}
          </p>
        )}
        {batch.isError && (
          <p role="alert" className="text-sm text-red-700">
            {userErrorMessage(batch.error)}
          </p>
        )}
        {query.isPending && (
          <p role="status" className="text-sm text-slate-600">
            {tr('common.loading')}
          </p>
        )}
        {query.isError && (
          <DocumentRequestError error={query.error} reload={() => void query.refetch()} />
        )}
        {rows.length ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[37rem] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2">
                    <input
                      className="size-4 accent-[#F66B17]"
                      type="checkbox"
                      aria-label={tr('documents.selectPage')}
                      checked={selectedAll}
                      disabled={batch.isPending}
                      onChange={(event) =>
                        setSelected(event.target.checked ? rows.map((r) => r.id) : [])
                      }
                    />
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {tr('common.full_name')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {tr('workerIntake.account')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {tr('workerIntake.certificates')}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {tr('workerIntake.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const name =
                    row.displayName || row.username || row.email || tr('workerIntake.unnamed');
                  const result = results[row.id];
                  return (
                    <tr
                      key={row.id}
                      className={
                        selected.includes(row.id)
                          ? 'border-t border-slate-200 bg-orange-50'
                          : 'border-t border-slate-200'
                      }
                    >
                      <td className="px-3 py-2">
                        <input
                          className="size-4 accent-[#F66B17]"
                          type="checkbox"
                          disabled={batch.isPending}
                          aria-label={tr('documents.selectWorker', {
                            name,
                            code: row.workerCode ?? '',
                          })}
                          checked={selected.includes(row.id)}
                          onChange={() =>
                            setSelected((current) =>
                              current.includes(row.id)
                                ? current.filter((id) => id !== row.id)
                                : [...current, row.id],
                            )
                          }
                        />
                      </td>
                      <th scope="row" className="px-3 py-2 font-semibold text-slate-900">
                        {name}
                        {row.workerCode && (
                          <span className="block font-mono text-xs text-slate-500">
                            {row.workerCode}
                          </span>
                        )}
                      </th>
                      <td className="px-3 py-2">
                        {tr(row.workerId ? 'workerIntake.accountReady' : 'workerIntake.draft')}
                        {row.email && (
                          <span className="block text-xs text-slate-500">{row.email}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            row.canSubmit || row.canProvision
                              ? 'font-medium text-emerald-800'
                              : 'text-slate-700'
                          }
                        >
                          {tr(
                            row.canSubmit
                              ? 'workerIntake.readyToSend'
                              : row.canProvision
                                ? 'workerIntake.readyToProvision'
                                : row.workerId
                                  ? 'documents.' + row.submissionStatus
                                  : 'workerIntake.incomplete',
                          )}
                        </span>
                        {row.missingKinds.length > 0 && (
                          <div className="text-xs text-amber-800">
                            {tr('workerIntake.missing', {
                              documents: row.missingKinds
                                .map((kind) => tr('documents.' + kind))
                                .join(', '),
                            })}
                          </div>
                        )}
                        {result && (
                          <div
                            role="status"
                            className={
                              result.status === 'SUCCEEDED'
                                ? 'text-xs text-emerald-800'
                                : 'text-xs text-red-700'
                            }
                          >
                            {result.status === 'SUCCEEDED'
                              ? tr('workerIntake.success')
                              : batchError(result.error?.code)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.workerId ? (
                          <Link
                            className="font-semibold text-orange-800 underline"
                            to={
                              '/worker-documents?' +
                              new URLSearchParams({
                                siteId: p.siteId,
                                workerId: row.workerId,
                                tab: 'documents',
                              })
                            }
                          >
                            {tr('workerIntake.openRecord')}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            className={documentButton}
                            disabled={batch.isPending}
                            onClick={() => setEditing({ formId: row.id, draft: row })}
                          >
                            {tr('workerIntake.edit')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          query.isSuccess && <p className="text-sm text-slate-600">{tr('workerIntake.empty')}</p>
        )}
      </div>
      <ActionDrawer
        isOpen={!!editing}
        title={tr(editing?.draft ? 'workerIntake.edit' : 'workerIntake.add')}
        onClose={close}
        panelClassName="max-sm:max-w-none"
      >
        {editing && (
          <IntakeDraftForm
            key={editing.formId}
            {...p}
            id={editing.formId}
            draft={editing.draft}
            onClose={close}
            onSaved={(next) => {
              void cache.invalidateQueries({ queryKey: key });
              const newForm = next ? { formId: crypto.randomUUID() } : undefined;
              setEditing((current) => (current?.formId === editing.formId ? newForm : current));
            }}
          />
        )}
      </ActionDrawer>
    </section>
  );
}

function IntakeDraftForm(
  p: IntakeScope & {
    contractorId: string;
    id: string;
    draft?: WorkerOnboardingDraft;
    onClose: () => void;
    onSaved: (next: boolean) => void;
  },
) {
  const nameField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameField.current?.focus();
  }, []);
  const [fields, setFields] = useState({
    displayName: p.draft?.displayName ?? '',
    username: p.draft?.username ?? '',
    email: p.draft?.email ?? '',
  });
  const [required, setRequired] = useState(p.draft?.safetyCardRequired ?? null);
  const [files, setFiles] = useState<Partial<Record<WorkerDocumentKind, File>>>({});
  const [dates, setDates] = useState<SaveWorkerOnboardingDraftCommand['documents']>(() => {
    const initial: SaveWorkerOnboardingDraftCommand['documents'] = {};
    for (const kind of documentKinds) {
      const stored = p.draft?.documents[kind];
      if (stored) {
        initial[kind] = { submittedIssuedOn: stored.submittedIssuedOn ?? undefined };
        if (kind !== 'HEALTH_CERTIFICATE')
          initial[kind].submittedExpiresOn = stored.submittedExpiresOn ?? undefined;
      }
    }
    return initial;
  });
  const preview = useMutation({
    mutationFn: async (kind: WorkerDocumentKind) => {
      const doc = p.draft?.documents[kind];
      if (!doc?.originalName || !doc.mediaType) throw new Error(tr('errors.notFound'));
      const blob = await p.client.workerOnboardingDraftFile(
        p.token,
        p.siteId,
        p.contractorId,
        p.id,
        kind,
      );
      return { blob, title: doc.originalName, type: doc.mediaType };
    },
  });
  const save = useMutation<WorkerOnboardingDraft, Error, boolean>({
    mutationFn: () => {
      const documents = { ...dates };
      for (const kind of documentKinds) {
        if (files[kind]) documents[kind] ??= {};
      }
      return p.client.saveWorkerOnboardingDraft(
        p.token,
        p.siteId,
        p.contractorId,
        p.id,
        {
          expectedVersion: p.draft?.version ?? 0,
          displayName: fields.displayName.trim(),
          username: fields.username.trim(),
          email: fields.email.trim(),
          safetyCardRequired: required,
          language: uiLanguage(),
          documents,
        },
        files,
      );
    },
    onSuccess: (_, next) => p.onSaved(next),
  });
  const changeDate = (
    kind: WorkerDocumentKind,
    field: 'submittedIssuedOn' | 'submittedExpiresOn',
    date: string,
  ) =>
    setDates((current) => ({
      ...current,
      [kind]: { ...current[kind], [field]: date || undefined },
    }));

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(false);
        }}
      >
        <fieldset disabled={save.isPending} className="grid gap-4">
          {(
            [
              ['displayName', 'common.full_name', 255],
              ['username', 'common.username', 64],
              ['email', 'worker_onboarding_view.email', 254],
            ] as const
          ).map(([field, label, limit]) => (
            <label key={field} className="grid gap-1 text-sm font-medium text-slate-700">
              {tr(label)}
              <input
                className={documentField}
                ref={field === 'displayName' ? nameField : undefined}
                value={fields[field]}
                maxLength={limit}
                inputMode={field === 'email' ? 'email' : undefined}
                onChange={(event) =>
                  setFields((current) => ({ ...current, [field]: event.target.value }))
                }
              />
            </label>
          ))}
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            {tr('documents.safetyCardRequired')}
            <SmartNativeSelect
              value={required === null ? '' : String(required)}
              className={documentField}
              onChange={(event) =>
                setRequired(event.target.value === '' ? null : event.target.value === 'true')
              }
            >
              <option value="">{tr('workerIntake.choose')}</option>
              <option value="true">{tr('documents.cardRequired')}</option>
              <option value="false">{tr('documents.cardNotRequired')}</option>
            </SmartNativeSelect>
          </label>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {documentKinds
              .filter((kind) => kind !== 'SAFETY_CARD' || required !== false)
              .map((kind) => {
                const existing = p.draft?.documents[kind];
                const savedName = existing?.originalName;
                const health = kind === 'HEALTH_CERTIFICATE';
                return (
                  <div key={kind} className="grid gap-2 p-3">
                    <DocumentAttachmentInput
                      label={tr('documents.' + kind)}
                      file={files[kind]}
                      savedName={savedName}
                      onChange={(file) => setFiles((current) => ({ ...current, [kind]: file }))}
                    />
                    {savedName && !files[kind] && (
                      <button
                        type="button"
                        className="justify-self-start text-xs font-semibold text-orange-800 underline"
                        disabled={preview.isPending}
                        onClick={() => preview.mutate(kind)}
                      >
                        {tr('documents.view')}
                      </button>
                    )}
                    <SmartDatePicker
                      label={tr(
                        health
                          ? 'documents.submittedIssuedOn'
                          : kind === 'PERSONAL_INSURANCE'
                            ? 'documents.coverageStartsOn'
                            : 'documents.cardIssuedOn',
                      )}
                      className={documentField}
                      disablePast={false}
                      clearable
                      value={dates[kind]?.submittedIssuedOn ?? ''}
                      onChange={(date) => changeDate(kind, 'submittedIssuedOn', date)}
                    />
                    {!health && (
                      <SmartDatePicker
                        label={tr('documents.expiresOn')}
                        className={documentField}
                        disablePast={false}
                        clearable
                        value={dates[kind]?.submittedExpiresOn ?? ''}
                        onChange={(date) => changeDate(kind, 'submittedExpiresOn', date)}
                      />
                    )}
                  </div>
                );
              })}
          </div>
          {save.isError && (
            <p role="alert" className="text-sm text-red-700">
              {userErrorMessage(save.error)}
            </p>
          )}
          {preview.isError && (
            <p role="alert" className="text-sm text-red-700">
              {userErrorMessage(preview.error)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={documentButton}>
              {tr('workerIntake.save')}
            </button>
            {!p.draft && (
              <button
                type="button"
                className={documentPrimaryButton}
                onClick={() => save.mutate(true)}
              >
                {tr('workerIntake.saveNext')}
              </button>
            )}
            <button type="button" className={documentButton} onClick={p.onClose}>
              {tr('common.cancel')}
            </button>
          </div>
        </fieldset>
      </form>
      {preview.data &&
        createPortal(
          <DocumentFilePreview {...preview.data} onClose={preview.reset} />,
          document.body,
        )}
    </>
  );
}
