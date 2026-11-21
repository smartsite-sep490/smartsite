import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { SafetyTaskTour } from '../safety/SafetyTaskTour';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import type { CameraPpeContext } from './CameraPpePolicyPanel';
import { resolveSavedVsAppliedState } from './camera-ppe-policy-model';
import {
  buildCameraSetupWorkspaceTourSteps,
  CAMERA_SETUP_WORKSPACE_TOUR_VERSION,
  registerCameraSetupTourCopy,
  resolveCameraSetupChecklistState,
  type CameraSetupMilestoneStatus,
  type CameraSetupOverallState,
} from './camera-setup-tour-model';
import {
  useCameraApplicationStatus,
  type CameraApplicationStatusContext,
} from './useCameraApplicationStatus';

registerCameraSetupTourCopy();

export interface CameraSetupTourProps {
  userId?: string | null;
  tourScopeKey: string;
  isAuthorized: boolean;
  hasSiteScope: boolean;
  canManageCameras: boolean;
  canAccessZones: boolean;
  selectedCamera: CameraResponse | null;
}

export function CameraSetupTour({
  userId,
  tourScopeKey,
  isAuthorized,
  hasSiteScope,
  canManageCameras,
  canAccessZones,
  selectedCamera,
}: CameraSetupTourProps) {
  registerCameraSetupTourCopy();
  const hasSelectedCamera = Boolean(selectedCamera);
  const isSelectedCameraActive = selectedCamera?.status === 'ACTIVE';
  const effectiveScopeKey = `${tourScopeKey}:${selectedCamera?.status ?? 'NONE'}`;
  const steps = useMemo(
    () =>
      buildCameraSetupWorkspaceTourSteps({
        hasSiteScope,
        canManageCameras,
        canAccessZones,
        hasSelectedCamera,
        isSelectedCameraActive,
      }),
    [hasSiteScope, canManageCameras, canAccessZones, hasSelectedCamera, isSelectedCameraActive],
  );

  return (
    <SafetyTaskTour
      taskId="camera-setup"
      tourVersion={CAMERA_SETUP_WORKSPACE_TOUR_VERSION}
      userId={userId}
      scopeKey={effectiveScopeKey}
      isAuthorized={isAuthorized}
      steps={steps}
    />
  );
}

function isUnauthorizedRegionError(error: unknown): boolean {
  return (
    (error instanceof ApiError && error.status === 401) ||
    Boolean(error && typeof error === 'object' && 'status' in error && error.status === 401)
  );
}

const OVERALL_BADGE_STYLES: Record<CameraSetupOverallState, string> = {
  APPLIED: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  SAVED_NOT_APPLIED: 'border-amber-200 bg-amber-50 text-amber-950',
  INCOMPLETE: 'border-slate-200 bg-slate-100 text-slate-700',
};

const MILESTONE_DOT_STYLES: Record<CameraSetupMilestoneStatus, string> = {
  complete: 'bg-emerald-600',
  attention: 'bg-amber-500',
  pending: 'bg-slate-300',
};

export interface CameraSetupChecklistProps {
  siteId?: string;
  selectedCamera: CameraResponse | null;
  policyContext?: CameraPpeContext;
  statusContext?: CameraApplicationStatusContext;
}

export function CameraSetupChecklist({
  siteId,
  selectedCamera,
  policyContext,
  statusContext,
}: CameraSetupChecklistProps) {
  registerCameraSetupTourCopy();
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const queryClient = useQueryClient();
  const lastConfigVersionRef = useRef<{ cameraId: string; version: number } | null>(null);

  const canQueryRegions = Boolean(
    selectedCamera &&
    selectedCamera.status === 'ACTIVE' &&
    policyContext &&
    typeof policyContext.client.listRegions === 'function',
  );

  const regionsQueryKey = useMemo(
    () => [
      ...(policyContext?.setupKey ?? ['camera-setup']),
      'ppe-policy',
      selectedCamera?.id ?? 'none',
      'regions',
    ],
    [policyContext?.setupKey, selectedCamera?.id],
  );

  const regionsQuery = useQuery({
    queryKey: regionsQueryKey,
    enabled: canQueryRegions,
    queryFn: async ({ signal }) => {
      const { client, token, siteId: contextSiteId } = policyContext!;
      const targetCameraId = selectedCamera!.id;
      const first = await client.listRegions(
        token,
        contextSiteId,
        targetCameraId,
        { limit: 100 },
        { signal },
      );
      const rows = [...first.items];
      while (rows.length < first.total) {
        const next = await client.listRegions(
          token,
          contextSiteId,
          targetCameraId,
          { offset: rows.length, limit: 100 },
          { signal },
        );
        if (!next.items.length || next.total !== first.total) {
          throw new Error('Region inventory changed');
        }
        rows.push(...next.items);
      }
      if (
        new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some((row) => row.cameraId !== targetCameraId)
      ) {
        throw new Error('Invalid Region inventory');
      }
      return rows;
    },
    retry: false,
  });

  useEffect(() => {
    if (!canQueryRegions || !selectedCamera) {
      lastConfigVersionRef.current = null;
      return;
    }
    const previous = lastConfigVersionRef.current;
    lastConfigVersionRef.current = {
      cameraId: selectedCamera.id,
      version: selectedCamera.configurationVersion,
    };
    if (
      previous &&
      previous.cameraId === selectedCamera.id &&
      previous.version !== selectedCamera.configurationVersion
    ) {
      void queryClient.invalidateQueries({ queryKey: regionsQueryKey });
    }
  }, [canQueryRegions, queryClient, regionsQueryKey, selectedCamera]);

  const unauthorizedRegionError = isUnauthorizedRegionError(regionsQuery.error);
  useEffect(() => {
    if (canQueryRegions && unauthorizedRegionError) {
      policyContext?.onUnauthorized();
    }
  }, [canQueryRegions, policyContext, unauthorizedRegionError]);

  const activeStatusContext = selectedCamera ? statusContext : undefined;
  const applicationStatus = useCameraApplicationStatus(
    {
      id: selectedCamera?.id ?? 'none',
      siteId: siteId ?? selectedCamera?.siteId ?? '',
      configurationVersion: selectedCamera?.configurationVersion ?? 0,
    },
    activeStatusContext,
  );

  const savedVsApplied = resolveSavedVsAppliedState({
    savedConfigurationVersion: selectedCamera?.configurationVersion,
    statusContext: activeStatusContext,
    statusResult: applicationStatus,
  });

  const activeRegions = regionsQuery.data?.filter((row) => row.isActive) ?? [];
  const regionsState = !canQueryRegions
    ? 'idle'
    : regionsQuery.isPending || regionsQuery.isFetching
      ? 'loading'
      : regionsQuery.isError
        ? 'error'
        : activeRegions.some((row) => row.geometryConfirmation?.status !== 'MANUALLY_CONFIRMED')
          ? 'needs-confirmation'
          : 'ready';

  const checklist = resolveCameraSetupChecklistState({
    hasSite: Boolean(siteId),
    selectedCamera,
    regionsState,
    activeRegionCount: activeRegions.length,
    savedVsApplied,
  });

  return (
    <div
      data-testid="camera-setup-checklist"
      data-tour-anchor="camera-setup-checklist"
      data-setup-state={checklist.overallState}
      data-setup-complete={checklist.isSetupComplete ? 'true' : 'false'}
      data-config-saved={checklist.isConfigSaved ? 'true' : 'false'}
      data-worker-applied={checklist.isWorkerApplied ? 'true' : 'false'}
      className="min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{t('cameraSetup.checklist.heading')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="camera-setup-checklist-overall"
            className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-sm font-semibold tabular-nums ${
              OVERALL_BADGE_STYLES[checklist.overallState]
            }`}
          >
            {t(checklist.overallKey, checklist.overallParams)}
          </span>
          {regionsState === 'error' && !unauthorizedRegionError && (
            <button
              type="button"
              className={CAMERA_BUTTON_STYLES.compactSecondary}
              disabled={regionsQuery.isFetching}
              onClick={() => void regionsQuery.refetch()}
            >
              {t('cameraSetup.checklist.retryRegions')}
            </button>
          )}
        </div>
      </div>

      <dl className="mt-2.5 grid divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/40 sm:grid-cols-2 sm:divide-y-0 sm:divide-x lg:grid-cols-4">
        {checklist.items.map((item) => (
          <div
            key={item.id}
            data-testid={`camera-setup-step-${item.id}`}
            data-step-status={item.status}
            className="min-w-0 px-3 py-2 text-sm"
          >
            <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <span
                aria-hidden="true"
                className={`h-2 w-2 shrink-0 rounded-full ${MILESTONE_DOT_STYLES[item.status]}`}
              />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                {t(item.labelKey)}
              </span>
            </dt>
            <dd className="mt-1 min-w-0 break-words [overflow-wrap:anywhere] text-sm font-semibold tabular-nums text-slate-950">
              {t(item.valueKey, item.valueParams)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
