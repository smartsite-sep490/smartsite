import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../../features/auth/auth-session';

import { WorkforceScheduleTab } from './WorkforceScheduleTab';
import { WorkforceManagerReviewTab } from './WorkforceManagerReviewTab';
import { IconCalendar, IconShield, IconLoader, IconAlertCircle } from '../../icons';
import { Button, Tabs } from '../../ui';
import { getWorkforceTabs } from '../utils/workforce-tabs';

// ─── Loading skeleton ────────────────────────────────────────────────────────
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50dvh] gap-3">
      <IconLoader className="w-6 h-6 animate-spin text-slate-500" />
      <p className="text-xs font-semibold text-slate-500">Loading workforce data...</p>
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
  return (
    <div className="max-w-md mx-auto mt-20 p-8 rounded-2xl border border-rose-200 bg-white text-center space-y-4 shadow-sm">
      <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 mx-auto flex items-center justify-center">
        <IconAlertCircle className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="text-xs text-slate-600 leading-relaxed">{detail}</p>
      {onRetry && (
        <Button variant="default" size="md" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function WorkforceView({ apiUrl: apiUrlProp }: { apiUrl: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const resolvedApiUrl = apiUrlProp || apiUrl;
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
  const isGlobalAdmin = roleAssignments.some(
    (r) => r.role === 'ADMIN' && r.siteId === null,
  );
  const scopedSiteIds = roleAssignments
    .map((r) => r.siteId)
    .filter((id): id is string => id !== null && id !== undefined);

  const sitesQuery = useQuery({
    queryKey: ['workforce', resolvedApiUrl, 'sites'],
    queryFn: () =>
      new SmartSiteManagementClient(resolvedApiUrl).listSites(accessToken!, {
        limit: 100,
      }),
    enabled: !!accessToken && isGlobalAdmin && !userLoading,
    retry: false,
  });

  // 3. Resolve selectedSiteId
  const requestedSiteId = searchParams.get('siteId');
  const autoSiteId = isGlobalAdmin
    ? sitesQuery.data?.items?.[0]?.id ?? null
    : scopedSiteIds[0] ?? null;
  const targetSiteAllowed = !requestedSiteId || scopedSiteIds.includes(requestedSiteId) || isGlobalAdmin;
  const selectedSiteId = requestedSiteId ?? autoSiteId;

  // 4. Role-based tab visibility
  const effectiveRoles = roleAssignments
    .filter(
      (r) =>
        r.siteId === selectedSiteId ||
        (r.role === 'ADMIN' && r.siteId === null),
    )
    .map((r) => r.role);

  const { showSchedule, showReview, defaultTab } =
    getWorkforceTabs(effectiveRoles);

  const [userSelectedTab, setUserSelectedTab] = useState<
    'schedule' | 'review' | null
  >(null);

  const activeTab =
    searchParams.get('tab') === 'review' && showReview ? 'review' :
    searchParams.get('tab') === 'schedule' && showSchedule ? 'schedule' :
    (userSelectedTab === 'review' && showReview) ||
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
          title="Session expired"
          detail="Your session has expired. Please log out and log in again."
        />
      );
    }
    return (
      <ErrorState
        title="Could not load user profile"
        detail="The server returned an error while loading your account."
        onRetry={() => void refetchUser()}
      />
    );
  }

  if (currentUser?.mustChangePassword) {
    return (
      <ErrorState
        title="Password change required"
        detail="Your account requires a password change before you can access Workforce."
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
        title={status === 403 ? 'Access denied' : 'Could not load sites'}
        detail={
          status === 403
            ? 'Your account does not have permission to list sites. Contact your system administrator.'
            : 'The server returned an error while loading site data. Try again later.'
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
        <h2 className="text-lg font-bold text-slate-900">No site assigned</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          Your account is not assigned to any site yet. Ask your Site Manager or Admin to add you to a site.
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
        <h2 className="text-lg font-bold text-slate-900">No access</h2>
        <p className="text-xs text-slate-600 leading-relaxed">
          Your current role does not include Workforce access on this site.
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
                label: 'My Schedule & Requests',
                icon: <IconCalendar className="w-3.5 h-3.5 text-blue-600" />,
              },
              {
                id: 'review' as const,
                label: 'Contractor Review',
                icon: <IconShield className="w-3.5 h-3.5 text-[#F66B17]" />,
              },
            ]}
            activeTab={activeTab as 'review' | 'schedule'}
            onChange={(tab) => {
              setUserSelectedTab(tab);
              const next = new URLSearchParams(searchParams);
              for (const key of ['tab', 'view', 'requestType', 'requestId']) next.delete(key);
              setSearchParams(next);
            }}
          />
        </div>
      )}

      {/* Tab Content */}
      <div>
        {activeTab === 'schedule' && (
          <WorkforceScheduleTab
            key={`${selectedSiteId}-${searchParams.get('requestId') ?? ''}`}
            apiUrl={resolvedApiUrl}
            siteId={selectedSiteId}
            token={accessToken}
            currentUserId={currentUser?.id ?? ''}
          />
        )}
        {activeTab === 'review' && (
          <WorkforceManagerReviewTab
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
