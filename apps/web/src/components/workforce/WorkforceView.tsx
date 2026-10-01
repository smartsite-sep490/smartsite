import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { useAuth, useCurrentUser } from '../../features/auth/auth-session';

import { WorkforceScheduleTab } from './WorkforceScheduleTab';
import { WorkforceManagerReviewTab } from './WorkforceManagerReviewTab';

// Exported so WorkforceView.test.tsx can test tab logic independently
export function getWorkforceTabs(roles: string[]) {
  const isWorker = roles.includes('WORKER');
  const isContractorRep = roles.includes('CONTRACTOR_REPRESENTATIVE');
  const isManager = roles.includes('SITE_MANAGER');

  return {
    showSchedule: isWorker || isContractorRep,
    showReview: isManager,
    defaultTab: (
      isManager ? 'review' : 'schedule'
    ) as 'schedule' | 'review',
  };
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50dvh] gap-4">
      <div className="animate-pulse flex space-x-2">
        <div className="w-2 h-2 bg-slate-400 rounded-full" />
        <div className="w-2 h-2 bg-slate-400 rounded-full" />
        <div className="w-2 h-2 bg-slate-400 rounded-full" />
      </div>
      <p className="text-sm text-slate-400">Loading workforce data…</p>
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
    <div className="max-w-xl mx-auto mt-24 rounded-2xl border border-red-200 bg-red-50 p-8 text-center space-y-3">
      <p className="text-2xl font-black text-red-700">{title}</p>
      <p className="text-sm text-red-600 leading-relaxed">{detail}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 px-4 py-2 text-sm font-bold rounded-lg bg-red-700 text-white hover:bg-red-800 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function WorkforceView({ apiUrl: apiUrlProp }: { apiUrl: string }) {
  const resolvedApiUrl = apiUrlProp || apiUrl;
  const { accessToken } = useAuth();

  // ── 1. Fetch authenticated user profile via /auth/me ─────────────────────
  // useCurrentUser uses the live accessToken from context and re-fetches after
  // hard refresh once useRestoreSession has restored the token. This avoids the
  // anti-pattern of useQuery(['auth','session']) without a queryFn.
  const {
    data: currentUser,
    isLoading: userLoading,
    isError: userError,
    error: userErrorObj,
    refetch: refetchUser,
  } = useCurrentUser(resolvedApiUrl);

  // ── 2. Determine site scope from roleAssignments ──────────────────────────
  // A global admin (ADMIN with siteId === null) can see all sites via GET /sites.
  // Other roles have site scope embedded in their roleAssignments — we read it
  // directly without calling GET /sites, which would fail if they lack permission.
  const roleAssignments = currentUser?.roleAssignments ?? [];
  const isGlobalAdmin = roleAssignments.some(
    (r) => r.role === 'ADMIN' && r.siteId === null,
  );
  const scopedSiteIds = roleAssignments
    .map((r) => r.siteId)
    .filter((id): id is string => id !== null && id !== undefined);

  // Only call GET /sites for global admins who are authorized to list all sites.
  // Non-admins derive their site from roleAssignments (scopedSiteIds).
  const sitesQuery = useQuery({
    queryKey: ['workforce', resolvedApiUrl, 'sites'],
    queryFn: () =>
      new SmartSiteManagementClient(resolvedApiUrl).listSites(accessToken!, {
        limit: 100,
      }),
    enabled: !!accessToken && isGlobalAdmin && !userLoading,
    retry: false,
  });

  // ── 3. Resolve selectedSiteId ─────────────────────────────────────────────
  const [overrideSiteId] = useState<string | null>(null);
  const autoSiteId = isGlobalAdmin
    ? sitesQuery.data?.items?.[0]?.id ?? null
    : scopedSiteIds[0] ?? null;
  const selectedSiteId = overrideSiteId ?? autoSiteId;

  // ── 4. Role-based tab visibility ──────────────────────────────────────────
  // Filter roleAssignments for the selected site (or global admin role).
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
    (userSelectedTab === 'review' && showReview) ||
    (userSelectedTab === 'schedule' && showSchedule)
      ? userSelectedTab
      : defaultTab;

  // ── 5. Render states ──────────────────────────────────────────────────────

  // Still restoring session — accessToken not yet available
  if (!accessToken) {
    return <LoadingState />;
  }

  // Fetching user profile
  if (userLoading) {
    return <LoadingState />;
  }

  // User profile failed
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
        detail="The server returned an error while loading your account. Check your connection and try again."
        onRetry={() => void refetchUser()}
      />
    );
  }

  // mustChangePassword — backend will 403 all resource endpoints
  if (currentUser?.mustChangePassword) {
    return (
      <ErrorState
        title="Password change required"
        detail="Your account requires a password change before you can access Workforce. Please change your password in Account Settings."
      />
    );
  }

  // Global admin: sites are still loading
  if (isGlobalAdmin && sitesQuery.isLoading) {
    return <LoadingState />;
  }

  // Global admin: sites query failed
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

  // No site resolved — non-admin with no site assigned
  if (!selectedSiteId) {
    return (
      <div className="max-w-xl mx-auto mt-24 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center space-y-3">
        <p className="text-2xl font-black text-amber-700">No site assigned</p>
        <p className="text-sm text-amber-600 leading-relaxed">
          Your account is not assigned to any site yet. Ask your Site Manager or
          Admin to add you to a site before accessing Workforce.
        </p>
      </div>
    );
  }

  // No tabs visible for this role — safety net
  if (!showSchedule && !showReview) {
    return (
      <div className="max-w-xl mx-auto mt-24 rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center space-y-3">
        <p className="text-2xl font-black text-slate-600">No access</p>
        <p className="text-sm text-slate-500 leading-relaxed">
          Your current role does not include Workforce access on this site.
        </p>
      </div>
    );
  }

  // ── 6. Main view ──────────────────────────────────────────────────────────

  return (
    <div className="max-w-[1400px] mx-auto space-y-6 pb-12">
      {/* Show tab switcher only when user has access to BOTH Worker Schedule & Manager Review */}
      {showSchedule && showReview && (
        <div className="flex gap-2 bg-white p-1.5 rounded-xl border border-[#DCE6EF] w-fit shadow-xs">
          <button
            onClick={() => setUserSelectedTab('schedule')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'schedule'
                ? 'bg-[#071A2B] text-white shadow-xs'
                : 'text-[#607A96] hover:bg-[#F5F8FB]'
            }`}
          >
            My Schedule &amp; Requests
          </button>
          <button
            onClick={() => setUserSelectedTab('review')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'review'
                ? 'bg-[#071A2B] text-white shadow-xs'
                : 'text-[#607A96] hover:bg-[#F5F8FB]'
            }`}
          >
            Manager Review
          </button>
        </div>
      )}

      {/* Tab content */}
      <div>
        {activeTab === 'schedule' && (
          <WorkforceScheduleTab
            apiUrl={resolvedApiUrl}
            siteId={selectedSiteId}
            token={accessToken}
          />
        )}
        {activeTab === 'review' && (
          <WorkforceManagerReviewTab
            apiUrl={resolvedApiUrl}
            siteId={selectedSiteId}
            token={accessToken}
          />
        )}
      </div>
    </div>
  );
}
