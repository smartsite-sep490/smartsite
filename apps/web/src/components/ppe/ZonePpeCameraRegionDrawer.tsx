import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse, RegionMutationResponse } from '@smartsite/contracts';
import { IconAlertTriangle } from '../icons';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';
import { CameraRegionCandidateReviewPanel } from './CameraRegionReferenceControls';
import { RegionPolygonCanvasEditor } from './RegionPolygonCanvasEditor';
import {
  LocalRegionValidationError,
  type EditingRegionScope,
  isConfigurationReferenceExpiredAt,
  isConfigurationReferenceScopeMatched,
  useConfigurationReferenceExpired,
} from './cameraRegionReferenceUtils';
import { validatePolygonGeometry, type NormalizedPoint } from './region-polygon-geometry';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

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
  lastSavedDraft: string | null;
  onAcceptCandidateReference: (candidate: CameraConfigurationReference) => void;
  onCancelCandidateReview: () => void;
  onScopeRevoked: (status: number) => void;
  onSaveSuccess: (
    data: RegionMutationResponse,
    savedDraftKey: string,
    savedPoints: NormalizedPoint[],
  ) => void;
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
  // Unmounting the previous owner aborts its write and suppresses callbacks.
  return <ZonePpeCameraRegionDrawerContent key={clientKey} {...props} client={client} />;
}

function ZonePpeCameraRegionDrawerContent(
  props: ZonePpeCameraRegionDrawerProps & { client: SmartSiteManagementClient },
) {
  const {
    siteId,
    selectedCamera,
    selectedZone,
    frozenReference,
    candidateReference,
    editingRegion,
    lastSavedDraft,
  } = props;
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const client = props.client;

  const initialPoints = useMemo(() => editingRegion?.initialPoints ?? [], [editingRegion]);
  const [draftPoints, setDraftPoints] = useState<NormalizedPoint[]>(() =>
    initialPoints.map(([x, y]) => [x, y]),
  );
  const [validationErrorKey, setValidationErrorKey] = useState<TranslationKey | null>(null);
  const [serverErrorKey, setServerErrorKey] = useState<TranslationKey | null>(null);

  const validationError = validationErrorKey ? t(validationErrorKey) : null;
  const serverError = serverErrorKey ? t(serverErrorKey) : null;

  const isReferenceExpired = useConfigurationReferenceExpired(frozenReference);
  const isCandidateExpired = useConfigurationReferenceExpired(candidateReference);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const createRegionMutation = useMutation({
    mutationFn: async (submittedPoints: NormalizedPoint[]) => {
      const geoErrorKey = validatePolygonGeometry(submittedPoints);
      if (geoErrorKey) throw new LocalRegionValidationError(geoErrorKey);
      if (JSON.stringify(submittedPoints) === lastSavedDraft) {
        throw new LocalRegionValidationError('regionSetup.validation.alreadySaved');
      }
      if (
        isConfigurationReferenceExpiredAt(frozenReference, Date.now()) ||
        !isConfigurationReferenceScopeMatched(frozenReference, siteId, selectedCamera)
      ) {
        throw new LocalRegionValidationError('regionSetup.error.referenceExpired');
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      const freshCamera = await client.getCamera(props.token, siteId, selectedCamera.id, {
        signal: controller.signal,
      });

      if (!isMountedRef.current || controller.signal.aborted) {
        throw new LocalRegionValidationError('regionSetup.error.cancelled');
      }
      if (isConfigurationReferenceExpiredAt(frozenReference, Date.now())) {
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

      const expectedConfigurationVersion = editingRegion
        ? editingRegion.expectedConfigurationVersion
        : frozenReference.configurationVersion;
      if (freshCamera.configurationVersion !== expectedConfigurationVersion) {
        throw new ApiError('http', 'Configuration version conflict', 409);
      }

      const reqOpts = { signal: controller.signal };
      const polygon = { coordinates: submittedPoints };
      if (editingRegion) {
        return client.updatePolygon(
          props.token,
          siteId,
          selectedCamera.id,
          editingRegion.id,
          { polygon, expectedConfigurationVersion },
          reqOpts,
        );
      }
      return client.createRegion(
        props.token,
        siteId,
        selectedCamera.id,
        { zoneId: selectedZone.id, polygon, expectedConfigurationVersion },
        reqOpts,
      );
    },
    onSuccess: (data: RegionMutationResponse, submittedPoints: NormalizedPoint[]) => {
      if (!isMountedRef.current) return;
      if (
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

  const handleSaveRegion = () => {
    if (createRegionMutation.isPending) return;
    if (isConfigurationReferenceExpiredAt(frozenReference, Date.now())) {
      return setValidationErrorKey('regionSetup.error.referenceExpired');
    }
    const geoErrorKey = validatePolygonGeometry(draftPoints);
    if (geoErrorKey) return setValidationErrorKey(geoErrorKey);
    if (JSON.stringify(draftPoints) === lastSavedDraft) {
      return setValidationErrorKey('regionSetup.validation.alreadySaved');
    }
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
    setValidationErrorKey(null);
    setServerErrorKey(null);
    props.onAcceptCandidateReference(candidateReference);
  };

  const { width, height, imageDataUrl } = frozenReference.frame;
  const canvasFrame = useMemo(
    () => ({ width, height, imageDataUrl }),
    [height, imageDataUrl, width],
  );

  return (
    <div className="space-y-3">
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
          className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex items-center gap-2"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{serverError}</span>
        </div>
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
        onChangePoints={setDraftPoints}
        onValidationError={setValidationErrorKey}
        onClearServerError={() => setServerErrorKey(null)}
        onSaveRegion={handleSaveRegion}
        onClose={props.onClose}
      />
    </div>
  );
}
