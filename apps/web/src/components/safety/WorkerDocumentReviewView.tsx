import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  SmartSiteManagementClient,
  WorkerComplianceResponse,
  WorkerDocumentSubmissionStatus,
} from '@smartsite/api-client';
import { translate as tr } from '../../i18n';
import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import { loadAllPages } from '../workforce/load-all-pages';
import {
  DocumentRequestError,
  documentButton,
  documentField,
} from '../workforce/components/DocumentAttachmentInput';
import { WorkerDocumentsPanel } from '../workforce/components/WorkerDocumentsPanel';
import { WorkerDocumentStatusTags } from '../workforce/components/WorkerDocumentStatusTags';

const pageSize = 20;

export function WorkerDocumentReviewView(p: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  scope: string;
  initialWorkerId?: string;
}) {
  useTranslation();
  const cache = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(p.initialWorkerId ?? '');
  const [submissionStatus, setSubmissionStatus] =
    useState<WorkerDocumentSubmissionStatus>('PENDING_REVIEW');
  const [search, setSearch] = useState('');
  const [contractorId, setContractorId] = useState('');
  const groupId = useId();
  const contractors = useQuery({
    queryKey: ['worker-document-contractors', p.scope, p.siteId],
    queryFn: ({ signal }) =>
      loadAllPages(
        (page) => p.client.listSafetyContractors(p.token, p.siteId, page, { signal }),
        signal,
      ),
  });
  const workers = useQuery({
    queryKey: [
      'worker-document-queue',
      p.scope,
      p.siteId,
      offset,
      search,
      submissionStatus,
      contractorId,
    ],
    queryFn: () =>
      p.client.listWorkerCompliance(p.token, p.siteId, {
        offset,
        limit: pageSize,
        search: search.trim() || undefined,
        submissionStatus,
        ...(contractorId && { contractorId }),
      }),
  });
  const total = workers.data?.total ?? 0;
  const contractorNames = new Map(contractors.data?.items.map(({ id, name }) => [id, name]));
  const groups = new Map<string | null, WorkerComplianceResponse[]>();
  for (const worker of workers.data?.items ?? []) {
    const group = groups.get(worker.contractorId);
    if (group) group.push(worker);
    else groups.set(worker.contractorId, [worker]);
  }
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['worker-document-queue', p.scope, p.siteId] });
    if (selected)
      void cache.invalidateQueries({ queryKey: ['worker-documents', p.scope, p.siteId, selected] });
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
        <input
          type="search"
          value={search}
          maxLength={120}
          aria-label={tr('documents.search')}
          placeholder={tr('documents.search')}
          className={documentField + ' max-w-xs'}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
        <SmartNativeSelect
          id="worker-document-contractor-filter"
          value={contractorId}
          aria-label={tr('common.contractor')}
          className={documentField + ' max-w-60'}
          disabled={contractors.isPending || contractors.isError}
          onChange={(event) => {
            setContractorId(event.target.value);
            setOffset(0);
            setSelected('');
          }}
        >
          <option value="">{tr('documents.allContractors')}</option>
          {contractors.data?.items.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </SmartNativeSelect>
        <SmartNativeSelect
          value={submissionStatus}
          aria-label={tr('documents.submissionFilter')}
          className={documentField + ' max-w-56'}
          onChange={(event) => {
            setSubmissionStatus(event.target.value === 'REVIEWED' ? 'REVIEWED' : 'PENDING_REVIEW');
            setOffset(0);
          }}
        >
          <option value="PENDING_REVIEW">{tr('documents.PENDING_REVIEW')}</option>
          <option value="REVIEWED">{tr('documents.REVIEWED')}</option>
        </SmartNativeSelect>
        <button type="button" className={documentButton} onClick={refresh}>
          {tr('documents.refresh')}
        </button>
      </div>
      {contractors.isError && (
        <DocumentRequestError error={contractors.error} reload={() => void contractors.refetch()} />
      )}
      <div className="grid min-w-0 gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <section className="min-w-0 self-start rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 p-3">
            <h2 className="text-sm font-semibold text-slate-900">{tr('common.workers')}</h2>
            <span className="text-xs text-slate-600">
              {tr('documents.profileCount', { count: total })}
            </span>
          </div>
          {workers.isPending && (
            <p role="status" className="p-3 text-sm text-slate-600">
              {tr('common.loading')}
            </p>
          )}
          {workers.isError && (
            <div className="p-3">
              <DocumentRequestError error={workers.error} reload={refresh} />
            </div>
          )}
          {workers.isSuccess && !workers.data.items.length && (
            <p className="p-3 text-sm text-slate-600">{tr('documents.noProfiles')}</p>
          )}
          {[...groups.entries()].map(([id, members], index) => {
            const headingId = `${groupId}-${index}`;
            const label = id
              ? (contractorNames.get(id) ?? tr('documents.contractorNameUnavailable'))
              : tr('documents.noContractor');
            return (
              <section key={id ?? 'unassigned'} aria-labelledby={headingId}>
                <h3
                  id={headingId}
                  className="break-words border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  {label}
                </h3>
                <ul className="divide-y divide-slate-200">
                  {members.map((worker) => (
                    <li key={worker.workerId}>
                      <button
                        type="button"
                        aria-pressed={selected === worker.workerId}
                        onClick={() => setSelected(worker.workerId)}
                        className={
                          'grid w-full min-w-0 gap-2 p-3 text-left focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-orange-600 ' +
                          (selected === worker.workerId ? 'bg-orange-50' : 'hover:bg-slate-50')
                        }
                      >
                        <span className="break-words text-sm font-semibold">
                          {worker.displayName}
                        </span>
                        <WorkerDocumentStatusTags profile={worker} workerCode={worker.externalId} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {total > pageSize && (
            <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 p-3">
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
                disabled={offset + pageSize >= total}
                onClick={() => setOffset(offset + pageSize)}
              >
                {tr('documents.next')}
              </button>
            </div>
          )}
        </section>
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
          {selected ? (
            <WorkerDocumentsPanel key={selected} {...p} workerId={selected} canReview />
          ) : (
            <p className="text-sm text-slate-600">{tr('documents.selectWorkerHint')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
