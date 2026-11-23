import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import { WorkerDocumentQuickScan, WorkerDocumentAiStatus } from './WorkerDocumentQuickScan';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  SmartSiteManagementClient,
  WorkerDocumentSubmissionStatus,
} from '@smartsite/api-client';
import { WorkerDocumentsPanel } from '../workforce/components/WorkerDocumentsPanel';
import { translate as tr } from '../../i18n';
import { userErrorMessage } from '../../i18n/messages';
import {
  IconSearch,
  IconClock,
  IconAlertTriangle,
  IconRefresh,
  IconLoader,
  IconChevronLeft,
  IconChevronRight,
  IconUsers,
} from '../icons';

export function WorkerDocumentReviewView(p: {
  client: SmartSiteManagementClient;
  token: string;
  siteId: string;
  scope: string;
  initialWorkerId?: string;
  canReview?: boolean;
  canUpload?: boolean;
}) {
  useTranslation();
  const cache = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(p.initialWorkerId ?? '');
  const [submissionStatus, setSubmissionStatus] = useState<WorkerDocumentSubmissionStatus | ''>('');
  const [needsSupplement, setNeedsSupplement] = useState(false);
  const [search, setSearch] = useState('');
  const selectionKey = [p.scope, p.siteId, offset, search, submissionStatus, needsSupplement].join(
    ':',
  );
  const [selection, setSelection] = useState({
    key: selectionKey,
    revision: 0,
    ids: [] as string[],
    activeWorker: null as string | null,
    manualWorker: null as string | null,
  });
  if (selection.key !== selectionKey) {
    setSelection({
      key: selectionKey,
      revision: selection.revision + 1,
      ids: [],
      activeWorker: null,
      manualWorker: null,
    });
  }
  const checkedIds = selection.key === selectionKey ? selection.ids : [];
  const toggleChecked = (id: string) =>
    setSelection((current) => ({
      ...current,
      ids: current.ids.includes(id)
        ? current.ids.filter((value) => value !== id)
        : [...current.ids, id],
    }));
  const workers = useQuery({
    queryKey: [
      'worker-document-queue',
      p.scope,
      p.siteId,
      offset,
      search,
      submissionStatus,
      needsSupplement,
    ],
    queryFn: () =>
      p.client.listWorkerCompliance(p.token, p.siteId, {
        offset,
        limit: 20,
        search,
        submissionStatus: submissionStatus || undefined,
        needsSupplement: needsSupplement || undefined,
      }),
  });

  const total = workers.data?.total ?? 0;
  const currentPage = Math.floor(offset / 20) + 1;
  const totalPages = Math.max(1, Math.ceil(total / 20));
  const refresh = () => {
    void workers.refetch();
    if (selected) {
      void cache.invalidateQueries({ queryKey: ['worker-documents', p.scope, p.siteId, selected] });
    }
  };

  return (
    <section className="min-w-0 space-y-4">
      {/* Screen-reader accessible title for tests & a11y */}
      <h2 className="sr-only">{tr('documents.reviewQueue')}</h2>

      <div className="grid items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_220px] xl:grid-cols-[minmax(0,1fr)_220px_auto_auto]">
        <div className="min-w-0 space-y-2">
          <label
            htmlFor="worker-documents-search-input"
            className="block text-xs font-medium text-slate-500"
          >
            {tr('documents.search')}
          </label>
          <div className="relative">
            <IconSearch className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="worker-documents-search-input"
              aria-label={tr('documents.search')}
              value={search}
              maxLength={120}
              placeholder={tr('documents.search')}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#F66B17] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
            />
          </div>
        </div>
        <label className="block min-w-0 space-y-2 text-xs font-medium text-slate-500">
          <span className="block">{tr('documents.submissionFilter')}</span>
          <SmartNativeSelect
            value={submissionStatus}
            onChange={(e) => {
              setSubmissionStatus(e.target.value as WorkerDocumentSubmissionStatus | '');
              setOffset(0);
            }}
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 text-sm text-slate-800 focus:border-[#F66B17] focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15"
          >
            <option value="">{tr('documents.allSubmissions')}</option>
            {(['NOT_SUBMITTED', 'PENDING_REVIEW', 'REVIEWED'] as const).map((status) => (
              <option key={status} value={status}>
                {tr(`documents.${status}`)}
              </option>
            ))}
          </SmartNativeSelect>
        </label>

        <label
          className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
            needsSupplement
              ? 'bg-rose-50 border-rose-300 text-rose-800 ring-1 ring-rose-300/40'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
          }`}
        >
          <input
            type="checkbox"
            checked={needsSupplement}
            onChange={(e) => {
              setNeedsSupplement(e.target.checked);
              setOffset(0);
            }}
            className="w-4 h-4 rounded text-[#F66B17] focus:ring-[#F66B17] border-slate-300 accent-[#F66B17] cursor-pointer shrink-0"
          />
          <span>{tr('documents.onlyNeedsSupplement')}</span>
        </label>
        <button
          type="button"
          onClick={refresh}
          disabled={workers.isFetching}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          <IconRefresh className={`h-4 w-4 shrink-0 ${workers.isFetching ? 'animate-spin' : ''}`} />
          {tr('documents.refresh')}
        </button>
      </div>

      {(p.canReview ?? true) && (
        <WorkerDocumentQuickScan
          compact
          key={selectionKey}
          client={p.client}
          token={p.token}
          siteId={p.siteId}
          profiles={
            workers.data?.items.filter((worker) => checkedIds.includes(worker.workerId)) ?? []
          }
          disabled={!!selection.manualWorker}
          onUpdated={refresh}
          onActiveChange={(workerId) =>
            setSelection((current) =>
              current.revision === selection.revision
                ? { ...current, activeWorker: workerId }
                : current,
            )
          }
        />
      )}

      <div className="grid min-w-0 grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-slate-200 p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">{tr('common.workers')}</h3>
            <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-500">
              {workers.isPending ? '…' : tr('documents.profileCount', { count: total })}
            </span>
          </div>

          {/* Loading state */}
          {workers.isPending && (
            <div
              role="status"
              className="flex items-center justify-center p-8 text-slate-500 gap-3"
            >
              <IconLoader className="w-5 h-5 animate-spin text-[#F66B17]" />
              <span className="text-sm font-semibold">{tr('common.loading')}</span>
            </div>
          )}

          {/* Error state */}
          {workers.isError && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 flex flex-wrap items-center justify-between gap-3 shadow-xs"
            >
              <div className="flex items-center gap-2.5">
                <IconAlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                <span className="font-semibold">{userErrorMessage(workers.error)}</span>
              </div>
              <button
                type="button"
                onClick={() => void workers.refetch()}
                className="px-3.5 py-1.5 rounded-xl bg-white border border-red-200 text-red-700 font-bold hover:bg-red-100 transition-colors shadow-2xs text-xs"
              >
                {tr('documents.refresh')}
              </button>
            </div>
          )}

          {/* Empty State */}
          {workers.data && workers.data.items.length === 0 && (
            <div className="space-y-2 rounded-xl bg-slate-50 p-6 text-center text-slate-500">
              <IconUsers className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm">{tr('documents.noProfiles')}</p>
            </div>
          )}

          {(p.canReview ?? true) && (
            <label className="mb-3 flex items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                aria-label={tr('documents.selectPage')}
                className="h-4 w-4 accent-orange-500"
                checked={
                  !!workers.data?.items.length &&
                  workers.data.items.every((worker) => checkedIds.includes(worker.workerId))
                }
                onChange={(event) =>
                  setSelection({
                    ...selection,
                    ids: event.target.checked
                      ? (workers.data?.items.map((worker) => worker.workerId) ?? [])
                      : [],
                  })
                }
              />
              {tr('documents.selectPageShort')}
            </label>
          )}
          {/* Worker List Stack without visible scrollbar */}
          <ul className="max-h-96 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] lg:max-h-[560px]">
            {workers.data?.items.map((w) => {
              const isSelected = selected === w.workerId;

              return (
                <li key={w.workerId} className="flex items-start gap-2 rounded-xl p-1">
                  {(p.canReview ?? true) && (
                    <input
                      type="checkbox"
                      className="mt-5 h-4 w-4 shrink-0 accent-orange-500"
                      aria-label={tr('documents.selectWorker', {
                        name: w.displayName,
                        code: w.externalId,
                      })}
                      checked={checkedIds.includes(w.workerId)}
                      onChange={() => toggleChecked(w.workerId)}
                    />
                  )}
                  <button
                    className={`min-w-0 flex-1 rounded-xl border border-transparent p-3 text-left transition-colors relative group cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F66B17] ${
                      isSelected
                        ? 'border-orange-300 bg-orange-50/60'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                    onClick={() => setSelected(w.workerId)}
                    aria-pressed={isSelected}
                  >
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#F66B17]" />
                    )}
                    <div className="space-y-2">
                      <div className="min-w-0 space-y-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-5 text-slate-800 [overflow-wrap:anywhere]">
                            {w.displayName}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 whitespace-nowrap">
                          <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-500">
                            {w.externalId}
                          </span>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                              w.submissionStatus === 'PENDING_REVIEW'
                                ? 'bg-amber-50 text-amber-800 border-amber-200/90'
                                : w.submissionStatus === 'REVIEWED'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/90'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                w.submissionStatus === 'PENDING_REVIEW'
                                  ? 'bg-amber-500'
                                  : w.submissionStatus === 'REVIEWED'
                                    ? 'bg-emerald-500'
                                    : 'bg-slate-400'
                              }`}
                            />
                            <span>{tr(`documents.${w.submissionStatus ?? 'NOT_SUBMITTED'}`)}</span>
                          </span>
                        </div>
                      </div>

                      {/* Sub-row for Warning / Supplement Badges and AI Status */}
                      {(w.needsSupplement ||
                        w.status === 'EXPIRED' ||
                        w.expiringKinds?.length > 0 ||
                        ((p.canReview ?? true) &&
                          (selection.activeWorker === w.workerId ||
                            selection.manualWorker === w.workerId))) && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-100">
                          {w.needsSupplement && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                              <span>{tr('documents.needsSupplement')}</span>
                            </span>
                          )}
                          {w.status === 'EXPIRED' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-50 text-red-800 border border-red-300 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
                              <span>{tr(`documents.${w.status}`)}</span>
                            </span>
                          )}
                          {(p.canReview ?? true) && (
                            <WorkerDocumentAiStatus
                              profile={w}
                              running={
                                selection.activeWorker === w.workerId ||
                                selection.manualWorker === w.workerId
                              }
                            />
                          )}
                          {!(p.canReview ?? true) && w.expiringKinds.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/80 shadow-2xs whitespace-nowrap">
                              <IconClock className="w-2.5 h-2.5 text-amber-600" />
                              <span>{tr('common.expiring_soon')}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Pagination Footer */}
          {workers.data && workers.data.total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
              <span className="font-medium text-slate-500">
                {tr('documents.queuePage', { page: currentPage, pages: totalPages, count: total })}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs"
                >
                  <IconChevronLeft className="w-3 h-3 text-slate-500" />
                  <span>{tr('documents.previous')}</span>
                </button>
                <button
                  type="button"
                  disabled={!workers.data || offset + 20 >= workers.data.total}
                  onClick={() => setOffset(offset + 20)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-2xs"
                >
                  <span>{tr('documents.next')}</span>
                  <IconChevronRight className="w-3 h-3 text-slate-500" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Selected Worker Details & Document Review */}
        <div className="min-w-0 p-4 sm:p-6">
          {selected ? (
            <WorkerDocumentsPanel
              key={selected}
              {...p}
              workerId={selected}
              analysisBusy={!!selection.activeWorker || !!selection.manualWorker}
              onAnalysisChange={(running) =>
                setSelection((current) =>
                  current.revision === selection.revision
                    ? { ...current, manualWorker: running ? selected : null }
                    : current,
                )
              }
              canReview={p.canReview ?? true}
            />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center text-slate-500 space-y-3">
              <IconUsers className="w-10 h-10 text-slate-400 mx-auto" />
              <div className="space-y-1">
                <p className="font-bold text-sm text-slate-700">
                  {tr('documents.noWorkerSelected')}
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  {tr('documents.selectWorkerHint')}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
