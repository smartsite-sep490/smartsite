import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { parseRegionPpePolicy } from '@smartsite/contracts/camera-ppe-policy';
import { EffectivePpePreviewBox } from '../cameras/CameraPpeOverview';
import { PolicyFields } from '../cameras/CameraPpePolicyPanel';
import {
  parseSavedCameraPolicy,
  resolveDraftEffectivePreview,
} from '../cameras/camera-ppe-policy-model';
import {
  ApiError,
  SmartSiteManagementClient,
  type ReferenceRegionMutationResponse,
  type ZoneResponse,
} from '@smartsite/api-client';
import type { CameraResponse, RegionMutationResponse } from '@smartsite/contracts';
import { parseRegionGeometryConfirmation } from '@smartsite/contracts/camera-region-geometry-confirmation';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { IconAlertTriangle } from '../icons';
import { CameraRegionCandidateReviewPanel } from './CameraRegionReferenceControls';
import { RegionPolygonCanvasEditor } from './RegionPolygonCanvasEditor';
import { RegionPolygonTaskTour } from './RegionPolygonTaskTour';
import { RegionReferenceViewConsentCheckbox } from './RegionReferenceViewConsentCheckbox';
import {
  LocalRegionValidationError,
  type EditingRegionScope,
  type RegionReferenceValidationErrorKey,
  getConfigurationReferenceIdentity,
  isConfigurationReferenceExpiredAt,
  isConfigurationReferenceScopeMatched,
  useConfigurationReferenceExpired,
} from './cameraRegionReferenceUtils';
import {
  registerRegionPolygonDrawerCatalog,
  type RegionPolygonDrawerErrorKey,
} from './region-polygon-drawer-catalog';
import './region-polygon-editor-catalog';
import {
  validatePolygonGeometry,
  type NormalizedPoint,
  type RegionPolygonValidationKey,
} from './region-polygon-geometry';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

registerRegionPolygonDrawerCatalog();

export interface ZonePpeCameraRegionDrawerProps {
  apiUrl: string;
  client?: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  credentialId: number;
  internalNonce: number;
  siteId: string;
  selectedCamera: CameraResponse;
  selectedZone: ZoneResponse;
  frozenReference: CameraConfigurationReference;
  candidateReference: CameraConfigurationReference | null;
  editingRegion?: EditingRegionScope | null;
  tourUserId?: string | null;
  lastSavedDraft: string | null;
  isLoadingReference?: boolean;
  onRequestFreshReference?: () => void;
  onAcceptCandidateReference: (candidate: CameraConfigurationReference) => void;
  onCancelCandidateReview: () => void;
  onScopeRevoked: (status: number) => void;
  onSaveSuccess: (
    data: RegionMutationResponse,
    savedDraftKey: string,
    savedPoints: NormalizedPoint[],
  ) => void;
  onDraftStateChange?: (state: { dirty: boolean; saving: boolean }) => void;
  onClose: () => void;
}

function invalidateRegionMutationQueries(
  queryClient: QueryClient,
  props: ZonePpeCameraRegionDrawerProps,
): void {
  const { apiUrl, sessionScope, internalNonce, credentialId, siteId, selectedCamera } = props;
  const keys = [
    [
      'ppe-monitoring',
      apiUrl,
      sessionScope,
      internalNonce,
      siteId,
      'cameras',
      selectedCamera.id,
      'regions',
    ],
    ['ppe-monitoring', apiUrl, sessionScope, internalNonce, siteId, 'cameras-for-region'],
    ['ppe-monitoring', apiUrl, sessionScope, credentialId, siteId, 'zones'],
    ['zone-admin', apiUrl, sessionScope, siteId, selectedCamera.id],
  ];
  for (const queryKey of keys) {
    queryClient.invalidateQueries({ queryKey });
  }
  queryClient.invalidateQueries({
    predicate: ({ queryKey }) =>
      queryKey[0] === 'camera-setup' &&
      queryKey[1] === apiUrl &&
      queryKey[2] === sessionScope &&
      queryKey[4] === credentialId &&
      (queryKey[6] === 'ppe-policy' ||
        (queryKey[6] === siteId &&
          (queryKey[7] === 'cameras' ||
            (queryKey[7] === 'selected-camera' && queryKey[8] === selectedCamera.id) ||
            (queryKey[7] === 'application-status' && queryKey[8] === selectedCamera.id)))),
  });
}

const drawerClientKeys = new WeakMap<SmartSiteManagementClient, number>();
let nextDrawerClientKey = 0;

export function ZonePpeCameraRegionDrawer(props: ZonePpeCameraRegionDrawerProps) {
  const client = useMemo(
    () => props.client ?? new SmartSiteManagementClient(props.apiUrl),
    [props.apiUrl, props.client],
  );
  let clientKey = drawerClientKeys.get(client);
  if (clientKey === undefined) {
    clientKey = ++nextDrawerClientKey;
    drawerClientKeys.set(client, clientKey);
  }
  const drawerScopeKey = [
    clientKey,
    props.apiUrl.trim(),
    props.token.trim(),
    props.sessionScope.trim(),
    props.credentialId,
    props.internalNonce,
    props.siteId.trim(),
    props.selectedCamera.id.trim(),
    props.selectedZone.id.trim(),
    props.editingRegion ? `${props.editingRegion.id}:${props.editingRegion.version}` : 'create',
  ].join('::');
  // Unmounting the previous owner/scope aborts its write and suppresses callbacks.
  return <ZonePpeCameraRegionDrawerContent key={drawerScopeKey} {...props} client={client} />;
}

function ZonePpeCameraRegionDrawerContent(
  props: ZonePpeCameraRegionDrawerProps & { client: SmartSiteManagementClient },
) {
  registerRegionPolygonDrawerCatalog();
  const {
    siteId,
    selectedCamera,
    selectedZone,
    frozenReference,
    candidateReference,
    editingRegion,
    lastSavedDraft,
    isLoadingReference = false,
    onRequestFreshReference,
    onDraftStateChange,
  } = props;
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const queryClient = useQueryClient();
  const client = props.client;
  const [policyDraft, setPolicyDraft] = useState<Parameters<typeof PolicyFields>[0]['value']>({
    mode: '',
  });
  const savedPolicy = useQuery({
    queryKey: [
      'region-create-policy',
      props.apiUrl,
      props.sessionScope,
      props.credentialId,
      props.internalNonce,
      siteId,
      selectedCamera.id,
      frozenReference.configurationVersion,
    ],
    queryFn: ({ signal }) =>
      client.readSavedPpePolicy(props.token, siteId, selectedCamera.id, null, { signal }),
    enabled: !editingRegion,
    retry: false,
  });
  const usesV2 = Boolean(savedPolicy.data?.policy);
  const policyError = savedPolicy.error;
  const { onScopeRevoked } = props;
  useEffect(() => {
    if (
      policyError instanceof ApiError &&
      [401, 403, 404].includes(policyError.status ?? 0) &&
      policyError.status !== undefined
    ) {
      onScopeRevoked(policyError.status);
    }
  }, [policyError, onScopeRevoked]);
  const ppePolicy = parseRegionPpePolicy(policyDraft);
  const savedCameraPolicy = parseSavedCameraPolicy(savedPolicy.data);
  const createRegionPreview =
    usesV2 && policyDraft.mode ? resolveDraftEffectivePreview(savedCameraPolicy, ppePolicy) : null;
  const policyReady = Boolean(
    editingRegion ||
    (savedPolicy.isSuccess &&
      !savedPolicy.isFetching &&
      savedPolicy.data.configurationVersion === frozenReference.configurationVersion &&
      (!usesV2 || ppePolicy)),
  );

  const initialPoints = useMemo(() => editingRegion?.initialPoints ?? [], [editingRegion]);
  const [draftPoints, setDraftPoints] = useState<NormalizedPoint[]>(() =>
    initialPoints.map(([x, y]) => [x, y]),
  );
  const [confirmedConsentKey, setConfirmedConsentKey] = useState<string | null>(null);
  const [validationErrorKey, setValidationErrorKey] = useState<
    RegionReferenceValidationErrorKey | RegionPolygonValidationKey | null
  >(null);
  const [serverErrorKey, setServerErrorKey] = useState<RegionPolygonDrawerErrorKey | null>(null);

  const validationError = validationErrorKey ? t(validationErrorKey) : null;
  const serverError = serverErrorKey ? t(serverErrorKey) : null;

  const isReferenceExpired = useConfigurationReferenceExpired(frozenReference);
  const isCandidateExpired = useConfigurationReferenceExpired(candidateReference);
  const currentDraftKey = JSON.stringify(draftPoints);
  const currentConsentBindingKey = `${getConfigurationReferenceIdentity(frozenReference)}::${currentDraftKey}`;
  const isReferenceScopeValid = isConfigurationReferenceScopeMatched(
    frozenReference,
    siteId,
    selectedCamera,
  );
  const isReferenceViewConfirmed =
    !isReferenceExpired &&
    isReferenceScopeValid &&
    confirmedConsentKey === currentConsentBindingKey;

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onDraftStateChangeRef = useRef(onDraftStateChange);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
      onDraftStateChangeRef.current?.({ dirty: false, saving: false });
    };
  }, []);

  const createRegionMutation = useMutation({
    mutationFn: async (submittedPoints: NormalizedPoint[]) => {
      const geoErrorKey = validatePolygonGeometry(submittedPoints);
      if (geoErrorKey) throw new LocalRegionValidationError(geoErrorKey);
      const submittedDraftKey = JSON.stringify(submittedPoints);
      if (submittedDraftKey === lastSavedDraft) {
        throw new LocalRegionValidationError('regionSetup.validation.alreadySaved');
      }
      if (
        isConfigurationReferenceExpiredAt(frozenReference, Date.now()) ||
        !isConfigurationReferenceScopeMatched(frozenReference, siteId, selectedCamera)
      ) {
        throw new LocalRegionValidationError('regionSetup.error.referenceExpired');
      }
      const submittedConsentKey = `${getConfigurationReferenceIdentity(frozenReference)}::${submittedDraftKey}`;
      if (!isReferenceViewConfirmed || confirmedConsentKey !== submittedConsentKey) {
        throw new Error('regionSetup.error.saveDefault');
      }
      const confirmReferenceView: true = isReferenceViewConfirmed;

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const freshCamera = await client.getCamera(props.token, siteId, selectedCamera.id, {
        signal: controller.signal,
      });

      if (!isMountedRef.current || controller.signal.aborted) {
        throw new LocalRegionValidationError('regionSetup.error.cancelled');
      }
      if (
        isConfigurationReferenceExpiredAt(frozenReference, Date.now()) ||
        !isConfigurationReferenceScopeMatched(frozenReference, siteId, selectedCamera)
      ) {
        throw new LocalRegionValidationError('regionSetup.error.referenceExpired');
      }
      if (
        freshCamera.id !== selectedCamera.id ||
        freshCamera.siteId !== siteId ||
        freshCamera.status !== 'ACTIVE' ||
        freshCamera.externalId !== selectedCamera.externalId ||
        freshCamera.externalId !== frozenReference.frame.cameraExternalId
      ) {
        throw new LocalRegionValidationError('regionSetup.error.cameraChangedOrInactive');
      }

      const expectedConfigurationVersion = frozenReference.configurationVersion;
      if (
        frozenReference.issuedReference.configurationVersion !== expectedConfigurationVersion ||
        (editingRegion &&
          editingRegion.expectedConfigurationVersion !== expectedConfigurationVersion) ||
        freshCamera.configurationVersion !== expectedConfigurationVersion
      ) {
        throw new ApiError('http', 'Configuration version conflict', 409);
      }

      const reqOpts = { signal: controller.signal };
      const baseCommand = {
        expectedConfigurationVersion,
        referenceId: frozenReference.issuedReference.referenceId,
        viewRevision: frozenReference.issuedReference.viewRevision,
        confirmReferenceView,
        polygon: { coordinates: submittedPoints },
      };
      if (editingRegion) {
        return client.updateReferencePolygon(
          props.token,
          siteId,
          selectedCamera.id,
          editingRegion.id,
          baseCommand,
          reqOpts,
        );
      }
      const createCommand = { ...baseCommand, zoneId: selectedZone.id };
      if (usesV2 && ppePolicy) {
        return client.createPolicyReferenceRegion(
          props.token,
          siteId,
          selectedCamera.id,
          { ...createCommand, ppePolicy },
          reqOpts,
        );
      }
      return client.createReferenceRegion(
        props.token,
        siteId,
        selectedCamera.id,
        createCommand,
        reqOpts,
      );
    },
    onSuccess: (data: ReferenceRegionMutationResponse, submittedPoints: NormalizedPoint[]) => {
      if (!isMountedRef.current) return;
      let confirmed: boolean;
      try {
        const confirmation = parseRegionGeometryConfirmation(data.region?.geometryConfirmation);
        confirmed =
          confirmation.status === 'MANUALLY_CONFIRMED' &&
          confirmation.referenceId === frozenReference.issuedReference.referenceId &&
          confirmation.viewRevision === frozenReference.issuedReference.viewRevision;
      } catch {
        confirmed = false;
      }
      if (
        !confirmed ||
        data.configurationVersion !== frozenReference.configurationVersion + 1 ||
        data.region.cameraId !== selectedCamera.id ||
        data.region.zoneId !== selectedZone.id ||
        (editingRegion && data.region.id !== editingRegion.id)
      ) {
        setServerErrorKey('regionSetup.error.wrongScope');
        return;
      }
      invalidateRegionMutationQueries(queryClient, props);
      props.onSaveSuccess(
        data,
        JSON.stringify(submittedPoints),
        submittedPoints.map(([x, y]) => [x, y]),
      );
    },
    onError: (err: unknown) => {
      if (!isMountedRef.current) return;
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403 || err.status === 404) {
          props.onScopeRevoked(err.status);
          return;
        }
        if (err.status === 409) {
          setServerErrorKey(editingRegion ? 'regionSetup.error.409Edit' : 'regionSetup.error.409');
          invalidateRegionMutationQueries(queryClient, props);
          return;
        }
      }
      if (err instanceof Error && err.name === 'AbortError') return;
      setServerErrorKey(
        err instanceof LocalRegionValidationError ? err.errorKey : 'regionSetup.error.saveDefault',
      );
    },
  });

  const handleDraftPointsChange = (nextPoints: NormalizedPoint[]) => {
    setConfirmedConsentKey(null);
    setDraftPoints(nextPoints);
  };

  const handleSaveRegion = () => {
    if (createRegionMutation.isPending || !policyReady) return;
    if (
      isConfigurationReferenceExpiredAt(frozenReference, Date.now()) ||
      !isConfigurationReferenceScopeMatched(frozenReference, siteId, selectedCamera)
    ) {
      return setValidationErrorKey('regionSetup.error.referenceExpired');
    }
    const geoErrorKey = validatePolygonGeometry(draftPoints);
    if (geoErrorKey) return setValidationErrorKey(geoErrorKey);
    if (currentDraftKey === lastSavedDraft) {
      return setValidationErrorKey('regionSetup.validation.alreadySaved');
    }
    if (!isReferenceViewConfirmed) return;
    setValidationErrorKey(null);
    setServerErrorKey(null);
    createRegionMutation.mutate(draftPoints.map(([x, y]) => [x, y]));
  };

  const handleAcceptCandidate = () => {
    if (
      !candidateReference ||
      createRegionMutation.isPending ||
      isConfigurationReferenceExpiredAt(candidateReference, Date.now()) ||
      !isConfigurationReferenceScopeMatched(candidateReference, siteId, selectedCamera)
    ) {
      return;
    }
    setConfirmedConsentKey(null);
    setValidationErrorKey(null);
    setServerErrorKey(null);
    props.onAcceptCandidateReference(candidateReference);
  };

  const { width, height, imageDataUrl } = frozenReference.frame;
  const isDirty =
    currentDraftKey !== JSON.stringify(initialPoints) && currentDraftKey !== lastSavedDraft;
  useEffect(() => {
    onDraftStateChangeRef.current = onDraftStateChange;
    onDraftStateChange?.({ dirty: isDirty, saving: createRegionMutation.isPending });
  }, [isDirty, createRegionMutation.isPending, onDraftStateChange]);
  const canvasFrame = useMemo(
    () => ({ width, height, imageDataUrl }),
    [height, imageDataUrl, width],
  );
  const targetCameraVersion = Math.max(
    selectedCamera.configurationVersion,
    editingRegion?.expectedConfigurationVersion ?? 0,
    !editingRegion && savedPolicy.isSuccess ? savedPolicy.data.configurationVersion : 0,
  );
  const isReferenceRevisionStale =
    frozenReference.configurationVersion !== selectedCamera.configurationVersion ||
    Boolean(
      editingRegion &&
      editingRegion.expectedConfigurationVersion !== frozenReference.configurationVersion,
    ) ||
    Boolean(
      !editingRegion &&
      savedPolicy.isSuccess &&
      savedPolicy.data.configurationVersion !== frozenReference.configurationVersion,
    );
  const geometryErrorKey = draftPoints.length >= 3 ? validatePolygonGeometry(draftPoints) : null;
  const isConsentDisabled =
    createRegionMutation.isPending || isReferenceExpired || !isReferenceScopeValid;
  const isConflictServerError =
    serverErrorKey === 'regionSetup.error.409' || serverErrorKey === 'regionSetup.error.409Edit';
  const showReloadConflictReferenceBtn = Boolean(
    onRequestFreshReference &&
    !candidateReference &&
    (isConflictServerError || isReferenceRevisionStale),
  );
  const hasPpePolicyControls = Boolean(
    !editingRegion &&
    usesV2 &&
    savedPolicy.isSuccess &&
    !savedPolicy.isFetching &&
    savedPolicy.data?.configurationVersion === frozenReference.configurationVersion,
  );
  const saveReadinessHint = isReferenceExpired
    ? t('regionSetup.drawer.readinessExpired')
    : currentDraftKey === lastSavedDraft
      ? t('regionSetup.drawer.readinessAlreadySaved')
      : isReferenceRevisionStale
        ? t('regionSetup.drawer.readinessRevisionStale', {
            refVersion: frozenReference.configurationVersion,
            camVersion: targetCameraVersion,
          })
        : draftPoints.length < 3
          ? t('regionSetup.drawer.readinessMinPoints', { remaining: 3 - draftPoints.length })
          : geometryErrorKey
            ? t(geometryErrorKey)
            : !isReferenceViewConfirmed
              ? t('regionSetup.drawer.readinessConfirmView')
              : !policyReady
                ? t('regionSetup.drawer.readinessPolicy')
                : t('regionSetup.drawer.readinessReady');

  const cameraDisplayLabel =
    selectedCamera.name.trim() && selectedCamera.name.trim() !== selectedCamera.code.trim()
      ? `${selectedCamera.name} · ${selectedCamera.code}`
      : selectedCamera.code;
  const authoringContextSummary = editingRegion
    ? t('regionSetup.drawer.imageContextEditingSummary', {
        zoneName: selectedZone.name,
        regionVersion: editingRegion.version,
        cameraLabel: cameraDisplayLabel,
        sourceKind: frozenReference.sourceKind,
        version: frozenReference.configurationVersion,
        width,
        height,
      })
    : t('regionSetup.drawer.imageContextSummary', {
        zoneName: selectedZone.name,
        cameraLabel: cameraDisplayLabel,
        sourceKind: frozenReference.sourceKind,
        version: frozenReference.configurationVersion,
        width,
        height,
      });

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1 space-y-1">
          <p
            data-testid="polygon-authoring-context"
            title={authoringContextSummary}
            className="min-w-0 break-words [overflow-wrap:anywhere] text-xs font-medium text-slate-700"
          >
            {authoringContextSummary}
          </p>
          <details
            data-testid="polygon-authoring-tech-details"
            className="text-[11px] text-slate-500"
          >
            <summary className="cursor-pointer select-none font-medium text-slate-500 hover:text-slate-800">
              {t('regionSetup.drawer.technicalDetailsSummary')}
            </summary>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-slate-600 break-all">
              <span className="select-all">
                {t('regionSetup.drawer.technicalZoneCode', { code: selectedZone.code })}
              </span>
              <span className="text-slate-500 select-all">
                {t('regionSetup.drawer.technicalZoneId', { id: selectedZone.id })}
              </span>
              <span className="text-slate-500 select-all">
                {t('regionSetup.drawer.technicalSourceId', { id: selectedCamera.externalId })}
              </span>
              {editingRegion && (
                <span className="text-slate-500 select-all">
                  {t('regionSetup.drawer.technicalRegionId', {
                    id: editingRegion.id,
                    version: editingRegion.version,
                  })}
                </span>
              )}
            </div>
          </details>
        </div>
        <RegionPolygonTaskTour
          apiUrl={props.apiUrl}
          sessionScope={props.sessionScope}
          credentialId={props.credentialId}
          internalNonce={props.internalNonce}
          siteId={siteId}
          selectedCamera={selectedCamera}
          selectedZone={selectedZone}
          frozenReference={frozenReference}
          editingRegion={editingRegion}
          tourUserId={props.tourUserId}
          isReferenceExpired={isReferenceExpired}
          isSaving={createRegionMutation.isPending}
          hasPpePolicyControls={hasPpePolicyControls}
        />
      </div>
      {candidateReference && (
        <CameraRegionCandidateReviewPanel
          candidateReference={candidateReference}
          isCandidateExpired={isCandidateExpired}
          draftPoints={draftPoints}
          isSaving={createRegionMutation.isPending}
          onAcceptCandidate={handleAcceptCandidate}
          onCancelReview={props.onCancelCandidateReview}
        />
      )}
      <RegionPolygonCanvasEditor
        points={draftPoints}
        initialPoints={initialPoints}
        lastSavedDraft={lastSavedDraft}
        editingRegion={
          editingRegion ? { id: editingRegion.id, version: editingRegion.version } : null
        }
        frame={canvasFrame}
        isImageStale={isReferenceExpired}
        isSaving={createRegionMutation.isPending}
        canSave={
          isReferenceViewConfirmed && policyReady && !isReferenceRevisionStale && !geometryErrorKey
        }
        saveReadinessHint={saveReadinessHint}
        inspectorSlot={
          <div data-tour-anchor="polygon-frozen-reference" className="min-w-0 space-y-2.5">
            {editingRegion?.needsViewRevalidation && (
              <div
                role="status"
                data-testid="polygon-revalidation-banner"
                className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950 flex items-start gap-2"
              >
                <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <span className="min-w-0 break-words">
                  {t('regionSetup.drawer.revalidationBanner')}
                </span>
              </div>
            )}
            {validationError && (
              <div
                role="alert"
                className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 flex items-center gap-2"
              >
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>{validationError}</span>
              </div>
            )}
            {serverError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  <span className="min-w-0 break-words">{serverError}</span>
                </div>
                {showReloadConflictReferenceBtn && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      data-testid="polygon-conflict-reload-reference"
                      disabled={isLoadingReference || createRegionMutation.isPending}
                      onClick={onRequestFreshReference}
                      className="rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-900 hover:bg-red-100 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {t('regionSetup.error.409ReloadBtn', {
                        version: Math.max(
                          targetCameraVersion,
                          frozenReference.configurationVersion + 1,
                        ),
                      })}
                    </button>
                  </div>
                )}
              </div>
            )}
            <RegionReferenceViewConsentCheckbox
              checked={isReferenceViewConfirmed}
              disabled={isConsentDisabled}
              onCheckedChange={(nextChecked) => {
                if (
                  createRegionMutation.isPending ||
                  isConfigurationReferenceExpiredAt(frozenReference, Date.now()) ||
                  !isReferenceScopeValid
                ) {
                  return;
                }
                setConfirmedConsentKey(nextChecked ? currentConsentBindingKey : null);
              }}
            />
            {editingRegion && (
              <p className="rounded-lg border border-slate-200/80 bg-white px-2.5 py-2 text-xs text-slate-600 break-words">
                {t('regionSetup.drawer.editGeometryPpeNote')}
              </p>
            )}
            {!editingRegion &&
              (savedPolicy.isError ? (
                <div role="alert">
                  {t('cameraPpe.error')}{' '}
                  <button type="button" onClick={() => void savedPolicy.refetch()}>
                    {t('cameraPpe.retry')}
                  </button>
                </div>
              ) : savedPolicy.isPending ? (
                <p role="status">{t('cameraPpe.loading')}</p>
              ) : savedPolicy.data?.configurationVersion !==
                frozenReference.configurationVersion ? (
                <p
                  role="alert"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900"
                >
                  {t('regionSetup.drawer.readinessRevisionStale', {
                    refVersion: frozenReference.configurationVersion,
                    camVersion:
                      savedPolicy.data?.configurationVersion ?? selectedCamera.configurationVersion,
                  })}
                </p>
              ) : (
                usesV2 && (
                  <fieldset disabled={createRegionMutation.isPending} className="min-w-0 space-y-2">
                    <PolicyFields
                      value={policyDraft}
                      onChange={setPolicyDraft}
                      allowInherit
                      label={t('regionSetup.drawer.regionPpePolicyLegend')}
                    />
                    {policyDraft.mode && <EffectivePpePreviewBox effective={createRegionPreview} />}
                  </fieldset>
                )
              ))}
          </div>
        }
        onChangePoints={handleDraftPointsChange}
        onValidationError={setValidationErrorKey}
        onClearServerError={() => setServerErrorKey(null)}
        onSaveRegion={handleSaveRegion}
        onClose={props.onClose}
      />
    </div>
  );
}
