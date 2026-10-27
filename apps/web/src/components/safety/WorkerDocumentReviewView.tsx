import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  SmartSiteManagementClient,
  WorkerDocumentSubmissionStatus,
} from '@smartsite/api-client';
import { WorkerDocumentStatusTags } from '../workforce/components/WorkerDocumentStatusTags';
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
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(p.initialWorkerId ?? '');
  const [submissionStatus, setSubmissionStatus] = useState<WorkerDocumentSubmissionStatus | ''>('');
  const [needsSupplement, setNeedsSupplement] = useState(false);
  const [search, setSearch] = useState('');
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

  return (
    <section className="space-y-6 rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-7 shadow-xs">
      {/* Header section with badge & title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-black text-[#041D2E] tracking-tight">
              {tr('documents.reviewQueue')}
            </h2>
            {total > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100/80 text-[#F66B17] border border-orange-200">
                {total}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
            {tr('documents.ocrHint')}
          </p>
        </div>

        {/* Refresh button */}
        <button
          type="button"
          onClick={() => void workers.refetch()}
          disabled={workers.isFetching}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-all shadow-2xs self-start sm:self-auto cursor-pointer"
        >
          <IconRefresh
            className={`w-3.5 h-3.5 text-slate-500 ${workers.isFetching ? 'animate-spin text-[#F66B17]' : ''}`}
          />
          <span>{tr('documents.refresh')}</span>
        </button>
      </div>

      {/* Main Review Area: 2-column Master-Detail on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Search, Filters & Worker Queue */}
        <div className="lg:col-span-5 space-y-4">
          {/* Filter and Search Bar */}
          <div className="p-3 sm:p-3.5 rounded-2xl border border-slate-200/90 bg-slate-50/60 space-y-2.5 shadow-2xs">
            <label className="block text-xs font-bold text-slate-700 space-y-1">
              <span className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                {tr('documents.search')}
              </span>
              <div className="relative">
                <IconSearch className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={search}
                  maxLength={120}
                  placeholder={tr('documents.search')}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all shadow-2xs"
                />
              </div>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block text-xs font-bold text-slate-700 space-y-1">
                <span className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500 truncate">
                  {tr('documents.submissionFilter')}
                </span>
                <select
                  value={submissionStatus}
                  onChange={(e) => {
                    setSubmissionStatus(e.target.value as WorkerDocumentSubmissionStatus | '');
                    setOffset(0);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-2xs focus:border-[#F66B17] focus:ring-2 focus:ring-[#F66B17]/15 focus:outline-none transition-all cursor-pointer"
                >
                  <option value="">{tr('documents.allSubmissions')}</option>
                  {(['NOT_SUBMITTED', 'PENDING_REVIEW', 'REVIEWED'] as const).map((status) => (
                    <option key={status} value={status}>
                      {tr(`documents.${status}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all cursor-pointer select-none text-xs font-bold shadow-2xs self-end h-[36px] ${
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
                <span className="truncate">{tr('documents.onlyNeedsSupplement')}</span>
              </label>
            </div>
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
            <div className="p-8 rounded-2xl border border-slate-200/80 bg-slate-50/50 text-center text-slate-500 space-y-2">
              <IconUsers className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="text-sm font-semibold">{tr('documents.noFile')}</p>
            </div>
          )}

          {/* Worker List Stack without visible scrollbar */}
          <ul className="space-y-2.5 max-h-[560px] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {workers.data?.items.map((w) => {
              const isSelected = selected === w.workerId;

              return (
                <li key={w.workerId}>
                  <button
                    className={`w-full rounded-2xl border p-3.5 text-left transition-all relative overflow-hidden group shadow-2xs cursor-pointer ${
                      isSelected
                        ? 'border-[#F66B17] bg-orange-50/50 ring-2 ring-[#F66B17]/20 shadow-xs'
                        : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                    onClick={() => setSelected(w.workerId)}
                    aria-pressed={isSelected}
                  >
                    {isSelected && (
                      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#F66B17]" />
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-xs shrink-0 shadow-2xs transition-colors ${
                            isSelected
                              ? 'bg-[#F66B17] text-white shadow-orange-500/20 shadow-sm'
                              : 'bg-gradient-to-br from-slate-100 to-slate-200/80 text-[#041D2E] border border-slate-200'
                          }`}
                        >
                          {w.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-sm text-slate-900 group-hover:text-[#F66B17] transition-colors truncate">
                            {w.displayName}
                          </p>
                          <span className="font-mono text-[11px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200/80">
                            {w.externalId}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0 max-w-[55%]">
                        <WorkerDocumentStatusTags profile={w} />
                        {!(p.canReview ?? true) && w.expiringKinds.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/80 shadow-2xs whitespace-nowrap">
                            <IconClock className="w-2.5 h-2.5 text-amber-600" />
                            <span>{tr('common.expiring_soon')}</span>
                          </span>
                        )}
                      </div>
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
        <div className="lg:col-span-7">
          {selected ? (
            <WorkerDocumentsPanel
              key={selected}
              {...p}
              workerId={selected}
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
