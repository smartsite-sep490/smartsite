import { translate as tr } from '../../../i18n';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import '../../../i18n';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useManagementClient, useAuth, useCurrentUser } from '../../../features/auth/auth-session';

import { WorkforceScheduleTab } from './WorkforceScheduleTab';
import { WorkforceManagerReviewTab } from './WorkforceManagerReviewTab';
import { IconCalendar, IconShield, IconLoader, IconAlertCircle } from '../../icons';
import { Button, Tabs } from '../../ui';
import { getWorkforceTabs } from '../utils/workforce-tabs';

// ─── Loading skeleton ────────────────────────────────────────────────────────
function LoadingState() {
  useTranslation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[50dvh] gap-3">
      <IconLoader className="w-6 h-6 animate-spin text-slate-500" />
      <p className="text-xs font-semibold text-slate-500">{tr('common.loading_workforce_data')}</p>
    </div>
  );
}

// ─── Error banner ─────────────────────────────────────────────────────────────
function ErrorState({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
}) {
  useTranslation();

  return (
    <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl border border-rose-200 bg-white text-center space-y-4 shadow-sm">
      <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
        <IconAlertCircle className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="text-xs text-slate-600 leading-relaxed">{detail}</p>
      {onRetry && (
        <Button variant="default" size="md" onClick={onRetry}>
          {tr('common.retry')}
        </Button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function WorkforceView({ apiUrl: apiUrlProp }: { apiUrl: string }) {
  useTranslation();

  const [searchParams, setSearchParams] = useSearchParams();
  const resolvedApiUrl = apiUrlProp || apiUrl;
  const client = useManagementClient(resolvedApiUrl);
  const { accessToken } = useAuth();

  // 1. Fetch authenticated user profile via /auth/me
  const {
    data: currentUser,
    isLoading: userLoading,
    isError: userError,
    error: userErrorObj,
    refetch: refetchUser,
  } = useCurrentUser(resolvedApiUrl);

  // 2. Determine site scope from roleAssignments
  const roleAssignments = currentUser?.roleAssignments ?? [];
  const isGlobalAdmin = roleAssignments.some((r) => r.role === 'ADMIN' && r.siteId === null);
  const scopedSiteIds = roleAssignments
    .map((r) => r.siteId)
    .filter((id): id is string => id !== null && id !== undefined);

  const sitesQuery = useQuery({
    queryKey: ['workforce', resolvedApiUrl, 'sites'],
    queryFn: () =>
      client.listSites(accessToken!, {
        limit: 100,
      }),
    enabled: !!accessToken && isGlobalAdmin && !userLoading,
    retry: false,
  });

  // 3. Resolve selectedSiteId
  const requestedSiteId = searchParams.get('siteId');
  const autoSiteId = isGlobalAdmin
    ? (sitesQuery.data?.items?.[0]?.id ?? null)
    : (scopedSiteIds[0] ?? null);
  const targetSiteAllowed =
    !requestedSiteId || scopedSiteIds.includes(requestedSiteId) || isGlobalAdmin;
  const selectedSiteId = requestedSiteId ?? autoSiteId;

  // 4. Role-based tab visibility
  const effectiveRoles = roleAssignments
    .filter((r) => r.siteId === selectedSiteId || (r.role === 'ADMIN' && r.siteId === null))
    .map((r) => r.role);

  const { showSchedule, showReview, defaultTab } = getWorkforceTabs(effectiveRoles);

  const [userSelectedTab, setUserSelectedTab] = useState<'schedule' | 'review' | null>(null);

  const activeTab =
    searchParams.get('tab') === 'review' && showReview
      ? 'review'
      : searchParams.get('tab') === 'schedule' && showSchedule
        ? 'schedule'
        : (userSelectedTab === 'review' && showReview) ||
            (userSelectedTab === 'schedule' && showSchedule)
          ? userSelectedTab
          : defaultTab;

  // ── 5. Render states ──────────────────────────────────────────────────────
  if (!accessToken || userLoading) {
    return <LoadingState />;
  }

  if (userError) {
    const status = (userErrorObj as { status?: number } | null)?.status;
    if (status === 401) {
      return (
        <ErrorState
          title={tr('common.session_expired')}
          detail="Your session has expired. Please log out and log in again."
        />
      );
    }
    return (
      <ErrorState
        title={tr('workforce_view.could_not_load_user_profile')}
        detail="The server returned an error while loading your account."
        onRetry={() => void refetchUser()}
      />
    );
  }

  if (isGlobalAdmin && sitesQuery.isLoading) {
    return <LoadingState />;
  }

  if (isGlobalAdmin && sitesQuery.isError) {
    const status = (sitesQuery.error as { status?: number } | null)?.status;
    return (
      <ErrorState
        title={
          status === 403
            ? tr('common.access_denied_cc11d4')
            : tr('workforce_view.could_not_load_sites')
        }
        detail={
          status === 403
            ? tr(
                'workforce_view.your_account_does_not_have_permission_to_list_sites_contact_your_system_administra',
              )
            : tr(
                'workforce_view.the_server_returned_an_error_while_loading_site_data_try_again_later',
              )
        }
        onRetry={status !== 403 ? () => void sitesQuery.refetch() : undefined}
      />
    );
  }

  if (!selectedSiteId) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl border border-amber-200 bg-white text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">{tr('common.no_site_assigned')}</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          {tr(
            'workforce_view.your_account_is_not_assigned_to_any_site_yet_ask_your_site_manager_or_admin_to_add',
          )}
        </p>
      </div>
    );
  }

  if (!targetSiteAllowed || (!showSchedule && !showReview)) {
    return (
      <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl border border-slate-200 bg-white text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-xl bg-slate-50 text-slate-500 mx-auto flex items-center justify-center">
          <IconShield className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">{tr('common.no_access')}</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          {tr('workforce_view.your_current_role_does_not_include_workforce_access_on_this_site')}
        </p>
      </div>
    );
  }

  // ── 6. Main view ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1400px] mx-auto space-y-5 pb-12 animate-in fade-in duration-300">
      {/* Tab Switcher if user has access to both views */}
      {showSchedule && showReview && (
        <div className="bg-white p-2 rounded-2xl border border-slate-200/90 shadow-xs w-fit">
          <Tabs
            items={[
              {
                id: 'schedule' as const,
                get label() {
                  return tr('app_layout.my_schedule_requests');
                },
                icon: <IconCalendar className="w-3.5 h-3.5 text-blue-600" />,
              },
              {
                id: 'review' as const,
                get label() {
                  return tr('common.contractor_review');
                },
                icon: <IconShield className="w-3.5 h-3.5 text-[#F66B17]" />,
              },
            ]}
            activeTab={activeTab as 'review' | 'schedule'}
            onChange={(tab) => {
              setUserSelectedTab(tab);
              const next = new URLSearchParams(searchParams);
              for (const key of ['tab', 'view', 'requestType', 'requestId']) next.delete(key);
              next.set('tab', tab);
              setSearchParams(next);
            }}
          />
        </div>
      )}

      {/* Tab Content */}
      <div>
        {activeTab === 'schedule' && (
          <WorkforceScheduleTab
            key={`${selectedSiteId}-${searchParams.get('requestId') ?? ''}-${searchParams.get('workDate') ?? ''}`}
            apiUrl={resolvedApiUrl}
            siteId={selectedSiteId}
            token={accessToken}
            currentUserId={currentUser?.id ?? ''}
          />
        )}
        {activeTab === 'review' && (
          <WorkforceManagerReviewTab
            canReview={effectiveRoles.includes('CONTRACTOR_REPRESENTATIVE')}
            key={`${selectedSiteId}-${searchParams.get('requestId') ?? ''}`}
            apiUrl={resolvedApiUrl}
            siteId={selectedSiteId}
            token={accessToken}
          />
        )}
      </div>
    </div>
  );
}
