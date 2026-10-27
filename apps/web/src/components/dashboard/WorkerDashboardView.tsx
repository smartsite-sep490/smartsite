import { useQuery } from '@tanstack/react-query';
import { useManagementClient, useAuth, useCurrentUser } from '../../features/auth/auth-session';
import { useTranslation } from 'react-i18next';
import { translate as tr } from '../../i18n';
import { WorkerAbsenceSummary } from '../workforce/components/WorkerAbsenceSummary';
import type { ActiveTab } from '../layout/AppLayout';
import type { DashboardNavigateContext } from './DashboardView';

function WorkerSiteSummary({
  apiUrl,
  token,
  siteId,
  userId,
}: {
  apiUrl: string;
  token: string;
  siteId: string;
  userId: string;
}) {
  const client = useManagementClient(apiUrl);
  const profile = useQuery({
    queryKey: ['worker-dashboard-profile', apiUrl, userId, siteId],
    queryFn: async () => {
      const [site, worker] = await Promise.all([
        client.getSite(token, siteId),
        client.myContractorTeam(token, siteId),
      ]);
      return { site, worker };
    },
    retry: false,
  });
  if (profile.isPending) return <p role="status">{tr('common.loading')}</p>;
  if (profile.isError)
    return (
      <div role="alert">
        {tr('worker_absence.unavailable')}{' '}
        <button type="button" onClick={() => void profile.refetch()} className="underline">
          {tr('common.retry')}
        </button>
      </div>
    );
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold">{profile.data.site.name}</h2>
      <WorkerAbsenceSummary
        apiUrl={apiUrl}
        token={token}
        siteId={siteId}
        workerId={profile.data.worker.workerId}
        sessionScope={userId}
      />
    </div>
  );
}

export function WorkerDashboardView({
  apiUrl,
  onNavigate,
}: {
  apiUrl: string;
  onNavigate: (tab: ActiveTab, context?: DashboardNavigateContext) => void;
}) {
  useTranslation();
  const { accessToken } = useAuth();
  const { data: user } = useCurrentUser(apiUrl);
  const sites = [
    ...new Set(
      user?.roleAssignments.filter((r) => r.role === 'WORKER' && r.siteId).map((r) => r.siteId!) ??
        [],
    ),
  ];
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-2xl font-bold text-[#071A2B]">{tr('worker_absence.dashboard')}</h1>
      {!accessToken || !user ? (
        <p role="status">{tr('common.loading')}</p>
      ) : !sites.length ? (
        <p>{tr('common.no_site_assigned')}</p>
      ) : (
        sites.map((siteId) => (
          <WorkerSiteSummary
            key={siteId}
            apiUrl={apiUrl}
            token={accessToken}
            siteId={siteId}
            userId={user.id}
          />
        ))
      )}
      <button
        type="button"
        className="rounded-xl bg-[#071A2B] px-4 py-2 font-semibold text-white focus-visible:outline-2 focus-visible:outline-blue-600"
        onClick={() => onNavigate('workforce')}
      >
        {tr('common.my_schedule')}
      </button>
    </div>
  );
}
