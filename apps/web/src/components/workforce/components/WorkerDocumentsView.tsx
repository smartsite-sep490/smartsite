import { SmartNativeSelect } from '../../ui/SmartNativeSelect';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth, useCurrentUser, useManagementClient } from '../../../features/auth/auth-session';
import { translate as tr } from '../../../i18n';
import { userErrorMessage } from '../../../i18n/messages';
import { WorkerDocumentsPanel } from './WorkerDocumentsPanel';
import { WorkerDocumentReviewView } from '../../safety/WorkerDocumentReviewView';
import { loadAllPages } from '../load-all-pages';
import { IconBuilding2, IconLoader, IconAlertTriangle } from '../../icons';

export function WorkerDocumentsView({ apiUrl }: { apiUrl: string }) {
  useTranslation();
  const [params, setParams] = useSearchParams();
  const { accessToken } = useAuth();
  const client = useManagementClient(apiUrl);
  const user = useCurrentUser(apiUrl);
  const requestedSite = params.get('siteId') ?? '';

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

  const siteUnavailable =
    !!requestedSite &&
    sites.isSuccess &&
    !!user.data &&
    !allowed.some((site) => site.id === requestedSite);
  const siteId = siteUnavailable
    ? ''
    : allowed.some((s) => s.id === requestedSite)
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

  if (siteUnavailable) return <p role="alert">{tr('safetyUi.siteUnavailable')}</p>;
  return (
    <div className="mx-auto max-w-7xl space-y-3 pb-8">
      {/* Site selector */}
      <div className="flex justify-end">
        {allowed.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 shadow-2xs self-start sm:self-auto">
            <IconBuilding2 className="w-4 h-4 text-[#F66B17] shrink-0" />
            <label
              htmlFor="worker-documents-site-select"
              className="text-xs font-bold uppercase tracking-wider text-slate-500 cursor-pointer"
            >
              {tr('common.site_fa7955')}
            </label>
            <span className="text-slate-300">|</span>
            <SmartNativeSelect
              id="worker-documents-site-select"
              value={siteId}
              onChange={(e) => setParams({ siteId: e.target.value })}
              className="border-0 bg-transparent py-0.5 pr-6 text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
            >
              {allowed.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SmartNativeSelect>
          </div>
        )}
      </div>

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
