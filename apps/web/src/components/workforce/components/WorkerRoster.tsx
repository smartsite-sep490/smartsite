import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { SmartSiteManagementClient, WorkerResponse } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { WorkerEnrollmentView } from '../../access/enrollment/WorkerEnrollmentView';
import { SmartNativeSelect } from '../../ui/SmartNativeSelect';
import { loadAllPages } from '../load-all-pages';
import {
  DocumentRequestError,
  documentButton,
  documentField,
  documentPrimaryButton,
} from './DocumentAttachmentInput';
import { WorkerDocumentsPanel } from './WorkerDocumentsPanel';
import { WorkerDocumentStatusTags } from './WorkerDocumentStatusTags';

type Section = 'documents' | 'information' | 'face';
const sections = [
  { id: 'documents', label: 'workerIntake.certificates' },
  { id: 'information', label: 'workerIntake.information' },
  { id: 'face', label: 'workerIntake.face' },
] as const;
const pageSize = 20;

export function WorkerRoster(p: {
  apiUrl: string;
  scope: string;
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  selected: string;
  tab: string | null;
  onSelect: (id: string, section: Section) => void;
}) {
  useTranslation();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const query = useQuery({
    queryKey: ['worker-roster', p.scope, p.siteId, offset, search, filter],
    queryFn: () =>
      p.client.listWorkerCompliance(p.token, p.siteId, {
        offset,
        limit: pageSize,
        search: search.trim() || undefined,
        needsSupplement: filter === 'supplement' || undefined,
        submissionStatus: filter === 'pending' ? 'PENDING_REVIEW' : undefined,
        expiringOnly: filter === 'expiring' || undefined,
      }),
  });
  const roster = useQuery({
    queryKey: ['worker-roster', p.scope, p.siteId, 'details'],
    enabled: !!p.selected,
    queryFn: ({ signal }) =>
      loadAllPages((page) => p.client.listWorkers(p.token, p.siteId, page), signal),
  });
  const active = roster.data?.items.find((worker) => worker.id === p.selected);
  const section = sections.find((candidate) => candidate.id === p.tab)?.id ?? 'documents';
  const limit = query.data?.total ?? 0;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)]">
      <section className="min-w-0 self-start rounded-2xl border border-slate-200 bg-white">
        <div className="space-y-2 border-b border-slate-200 p-3">
          <input
            type="search"
            value={search}
            maxLength={120}
            aria-label={tr('documents.search')}
            placeholder={tr('documents.search')}
            className={documentField}
            onChange={(event) => {
              setSearch(event.target.value);
              setOffset(0);
            }}
          />
          <SmartNativeSelect
            value={filter}
            aria-label={tr('documents.submissionFilter')}
            className={documentField}
            onChange={(event) => {
              setFilter(event.target.value);
              setOffset(0);
            }}
          >
            <option value="all">{tr('workerIntake.all')}</option>
            <option value="supplement">{tr('documents.needsSupplement')}</option>
            <option value="pending">{tr('documents.PENDING')}</option>
            <option value="expiring">{tr('common.expiring_soon')}</option>
          </SmartNativeSelect>
        </div>
        {query.isError && (
          <div className="p-3">
            <DocumentRequestError error={query.error} reload={() => void query.refetch()} />
          </div>
        )}
        {query.isPending && (
          <p role="status" className="p-3 text-sm text-slate-600">
            {tr('common.loading')}
          </p>
        )}
        {query.isSuccess && !query.data.items.length && (
          <p className="p-3 text-sm text-slate-600">{tr('documents.noProfiles')}</p>
        )}
        <ul className="divide-y divide-slate-200">
          {query.data?.items.map((row) => (
            <li key={row.workerId}>
              <button
                type="button"
                aria-pressed={row.workerId === p.selected}
                onClick={() => p.onSelect(row.workerId, 'documents')}
                className={
                  'grid w-full gap-2 p-3 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-orange-600 ' +
                  (row.workerId === p.selected ? 'bg-orange-50' : 'hover:bg-slate-50')
                }
              >
                <div className="min-w-0">
                  <span className="break-words text-sm font-semibold text-slate-900">
                    {row.displayName}
                  </span>
                  <span className="ml-2 font-mono text-xs text-slate-500">{row.externalId}</span>
                </div>
                <WorkerDocumentStatusTags profile={row} />
                {!!row.expiringKinds.length && (
                  <span className="text-xs font-medium text-amber-800">
                    {tr('common.expiring_soon')}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {limit > pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 p-3">
            <button
              className={documentButton}
              type="button"
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - pageSize))}
            >
              {tr('documents.previous')}
            </button>
            <button
              className={documentButton}
              type="button"
              disabled={offset + pageSize >= limit}
              onClick={() => setOffset(offset + pageSize)}
            >
              {tr('documents.next')}
            </button>
          </div>
        )}
      </section>
      <section className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        {!p.selected && (
          <p className="text-sm text-slate-600">{tr('documents.noWorkerSelected')}</p>
        )}
        {p.selected && roster.isPending && <p role="status">{tr('common.loading')}</p>}
        {p.selected && roster.isError && (
          <DocumentRequestError error={roster.error} reload={() => void roster.refetch()} />
        )}
        {p.selected && roster.isSuccess && !active && <p role="alert">{tr('errors.notFound')}</p>}
        {active && (
          <div className="space-y-4">
            <header>
              <h2 className="text-lg font-bold text-slate-900">{active.displayName}</h2>
              <p className="flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="font-mono">{active.externalId}</span>
                <span>{tr(active.isActive ? 'common.active' : 'workerIntake.suspended')}</span>
              </p>
            </header>
            <div
              role="group"
              aria-label={tr('workerIntake.recordTitle')}
              className="flex flex-wrap gap-1 border-b border-slate-200 pb-2"
            >
              {sections.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={section === id}
                  className={
                    documentButton +
                    (section === id ? ' border-orange-500 bg-orange-50 text-orange-900' : '')
                  }
                  onClick={() => p.onSelect(active.id, id)}
                >
                  {tr(label)}
                </button>
              ))}
            </div>
            {section === 'documents' && (
              <WorkerDocumentsPanel
                key={active.id}
                {...p}
                workerId={active.id}
                section="documents"
                canUpload
              />
            )}
            {section === 'information' && (
              <>
                <WorkerInformationEditor key={active.id} {...p} worker={active} />
                <details className="rounded-lg border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    {tr('documents.personalDetails')}
                  </summary>
                  <div className="mt-3">
                    <WorkerDocumentsPanel
                      key={active.id}
                      {...p}
                      workerId={active.id}
                      section="identity"
                    />
                  </div>
                </details>
              </>
            )}
            {section === 'face' && (
              <WorkerEnrollmentView
                key={active.id}
                apiUrl={p.apiUrl}
                token={p.token}
                siteId={p.siteId}
                sessionScope={p.scope}
                canManageAccounts={false}
                worker={active}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function WorkerInformationEditor(p: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  worker: WorkerResponse;
}) {
  const cache = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [displayName, setDisplayName] = useState(p.worker.displayName);
  const [isActive, setActive] = useState(p.worker.isActive);
  const [base, setBase] = useState({
    externalId: p.worker.externalId,
    displayName: p.worker.displayName,
    isActive: p.worker.isActive,
  });
  const save = useMutation({
    mutationFn: () =>
      p.client.updateContractorWorker(p.token, p.siteId, p.worker.contractorId!, p.worker.id, {
        externalId: base.externalId,
        displayName: displayName.trim(),
        isActive,
        expectedSnapshot: base,
      }),
    onSuccess: () => {
      setEdit(false);
      void cache.invalidateQueries({ queryKey: ['worker-roster'] });
      void cache.invalidateQueries({ queryKey: ['worker-intake-drafts'] });
      void cache.invalidateQueries({ queryKey: ['worker-documents'] });
    },
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        {tr('workerIntake.account')}:{' '}
        {tr(p.worker.userId ? 'workerIntake.accountReady' : 'workerIntake.accountMissing')}
      </p>
      {edit ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (displayName.trim()) save.mutate();
          }}
          className="rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          <fieldset disabled={save.isPending} className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium">
              {tr('common.full_name')}
              <input
                className={documentField}
                required
                maxLength={255}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {tr('common.worker_status')}
              <SmartNativeSelect
                className={documentField}
                value={String(isActive)}
                onChange={(event) => setActive(event.target.value === 'true')}
              >
                <option value="true">{tr('common.active')}</option>
                <option value="false">{tr('workerIntake.suspended')}</option>
              </SmartNativeSelect>
            </label>
            <p className="text-xs text-slate-600">
              {tr(
                'worker_onboarding_view.suspension_prevents_gate_access_and_keeps_the_worker_s_history_restoring_a_worker',
              )}
            </p>
            {save.isError && (
              <p role="alert" className="text-sm text-red-700">
                {userErrorMessage(save.error)}
              </p>
            )}
            <div className="flex gap-2">
              <button className={documentPrimaryButton} type="submit">
                {tr('workerIntake.saveInformation')}
              </button>
              <button className={documentButton} type="button" onClick={() => setEdit(false)}>
                {tr('common.cancel')}
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        p.worker.contractorId && (
          <button
            className={documentButton}
            type="button"
            onClick={() => {
              setBase({
                externalId: p.worker.externalId,
                displayName: p.worker.displayName,
                isActive: p.worker.isActive,
              });
              setDisplayName(p.worker.displayName);
              setActive(p.worker.isActive);
              setEdit(true);
            }}
          >
            {tr('workerIntake.editInformation')}
          </button>
        )
      )}
    </div>
  );
}
