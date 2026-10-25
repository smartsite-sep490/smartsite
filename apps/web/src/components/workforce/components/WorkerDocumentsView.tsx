import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth, useCurrentUser, useManagementClient } from '../../../features/auth/auth-session';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { WorkerDocumentsPanel } from './WorkerDocumentsPanel';
import { WorkerDocumentReviewView } from '../../safety/WorkerDocumentReviewView';
import { loadAllPages } from '../load-all-pages';
import { IconBuilding2, IconShield, IconLoader, IconAlertTriangle } from '../../icons';

export function WorkerDocumentsView({ apiUrl }: { apiUrl: string }) {
  useTranslation();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const { accessToken } = useAuth();
  const client = useManagementClient(apiUrl);
  const user = useCurrentUser(apiUrl);
  const [requestedSite, setRequestedSite] = useState(params.get('siteId') ?? '');

  const sites = useQuery({
    queryKey: ['worker-document-sites', apiUrl, user.data?.id],
    enabled: !!accessToken,
    queryFn: ({ signal }) => loadAllPages((p) => client.listSites(accessToken!, p), signal),
  });

  const allowed =
    sites.data?.items.filter((s) =>
      user.data?.roleAssignments.some(
        (r) =>
          r.siteId === s.id &&
          ['WORKER', 'CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER'].includes(r.role),
      ),
    ) ?? [];

  const siteId = allowed.some((s) => s.id === requestedSite)
    ? requestedSite
    : (allowed[0]?.id ?? '');

  const safety =
    user.data?.roleAssignments.some((r) => r.siteId === siteId && r.role === 'SAFETY_OFFICER') ??
    false;

  const rep =
    user.data?.roleAssignments.some(
      (r) => r.siteId === siteId && r.role === 'CONTRACTOR_REPRESENTATIVE',
    ) ?? false;

  const own = useQuery({
    queryKey: ['worker-document-self', apiUrl, user.data?.id, siteId],
    enabled: !!siteId && !safety && !rep,
    queryFn: () => client.myContractorTeam(accessToken!, siteId),
  });

  if (user.isError || sites.isError || own.isError) {
    const failed = user.isError ? user : sites.isError ? sites : own;
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 flex items-center gap-3 shadow-xs"
      >
        <IconAlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
        <span className="font-semibold">{userErrorMessage(failed.error)}</span>
        <button
          type="button"
          className="font-semibold underline focus-visible:outline-2"
          onClick={() => void failed.refetch()}
        >
          {tr('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-7 pb-12">
      {/* Hero Header */}
      <header className="rounded-2xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-orange-50 border border-orange-200/80 text-[11px] font-black uppercase tracking-wider text-[#F66B17]">
              <span>MF01</span>
              <span>·</span>
              <IconShield className="w-3.5 h-3.5" />
              <span>{tr('documents.title')}</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#041D2E] tracking-tight">
              {tr('documents.title')}
            </h1>
            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              {tr('documents.hint')}
            </p>
          </div>

          {/* Site Selector Card */}
          {allowed.length > 0 && (
            <div className="shrink-0 w-full sm:w-72 rounded-xl border border-slate-200/90 bg-slate-50/70 p-3.5 space-y-1.5 shadow-2xs">
              <label
                htmlFor="worker-documents-site-select"
                className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500"
              >
                <IconBuilding2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{tr('common.site_fa7955')}</span>
              </label>
              <select
                id="worker-documents-site-select"
                value={siteId}
                onChange={(e) => setRequestedSite(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-2xs focus:border-[#F66B17] focus:outline-none focus:ring-2 focus:ring-[#F66B17]/15 transition-all"
              >
                {allowed.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      {/* Loading state */}
      {(user.isPending || sites.isPending) && (
        <div role="status" className="flex items-center justify-center p-12 text-slate-500 gap-3">
          <IconLoader className="w-5 h-5 animate-spin text-[#F66B17]" />
          <span className="text-sm font-semibold">{tr('common.loading')}</span>
        </div>
      )}

      {/* Main Content Area */}
      {siteId &&
        user.data &&
        accessToken &&
        (safety || rep ? (
          <WorkerDocumentReviewView
            key={siteId}
            client={client}
            token={accessToken}
            siteId={siteId}
            scope={apiUrl + ':' + user.data.id}
            canReview={safety}
            canUpload={rep}
            initialWorkerId={params.get('workerId') ?? undefined}
          />
        ) : own.data?.workerId ? (
          <WorkerDocumentsPanel
            key={siteId + own.data.workerId}
            client={client}
            token={accessToken}
            siteId={siteId}
            workerId={own.data.workerId}
            scope={apiUrl + ':' + user.data.id}
          />
        ) : null)}
    </div>
  );
}
