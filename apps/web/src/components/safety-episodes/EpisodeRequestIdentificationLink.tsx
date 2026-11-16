import { useQuery } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import './tracked-episode-workspace-catalog';
import {
  isSafetyIdentificationRouteEnabled,
  sameSafetyId,
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from './safetyUrlParams';

const REQUEST_ID_LINK_KEY = 'episodes.requestIdentificationAction';
const REQUEST_ID_UNAVAILABLE_KEY = 'episodes.identificationUnavailableHint';

export interface IdentificationAvailabilityClient {
  listSafetyIdentificationRequests?: SmartSiteManagementClient['listSafetyIdentificationRequests'];
}

export function EpisodeRequestIdentificationLink({
  siteId,
  episodeId,
  originRecipientId,
  client,
  token,
  scope,
  enableIdentification,
}: {
  siteId: string;
  episodeId: string;
  originRecipientId: string;
  client?: IdentificationAvailabilityClient;
  token?: string;
  scope?: string;
  enableIdentification?: boolean;
}) {
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const [current] = useSearchParams();
  const routeEnabled = isSafetyIdentificationRouteEnabled(enableIdentification);
  const safeSiteId = sanitizeSafetyQueryId(siteId);
  const safeEpisodeId = sanitizeSafetyQueryId(episodeId);
  const safeOriginRecipientId = sanitizeSafetyUuid(originRecipientId);

  const canProbeRead =
    routeEnabled &&
    Boolean(safeSiteId && safeEpisodeId && safeOriginRecipientId) &&
    Boolean(token?.trim()) &&
    typeof client?.listSafetyIdentificationRequests === 'function';

  const availability = useQuery({
    queryKey: ['safety-identification-availability', scope ?? 'default', safeSiteId ?? ''],
    queryFn: ({ signal }) =>
      client!.listSafetyIdentificationRequests!(
        token!,
        safeSiteId!,
        { offset: 0, limit: 1 },
        { signal },
      ),
    enabled: canProbeRead,
    staleTime: 30_000,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (!routeEnabled || !safeSiteId || !safeEpisodeId || !safeOriginRecipientId) {
    return null;
  }

  if (canProbeRead) {
    if (availability.isPending) {
      return null;
    }
    if (availability.isError) {
      const status = availability.error instanceof ApiError ? availability.error.status : undefined;
      if (status === 404 || status === 503) {
        return (
          <p
            role="status"
            data-testid="episode-identification-unavailable"
            className="text-xs font-medium text-slate-600"
          >
            {tSafety(REQUEST_ID_UNAVAILABLE_KEY)}
          </p>
        );
      }
      return null;
    }
  }

  const search = new URLSearchParams({
    tab: 'identification',
    siteId: safeSiteId,
    episodeId: safeEpisodeId,
    originRecipientId: safeOriginRecipientId,
  });

  const currentSiteId = sanitizeSafetyQueryId(current.get('siteId'));
  const currentRecipientId = sanitizeSafetyUuid(current.get('recipientId'));
  const matchesCurrentEpisodeContext =
    current.get('tab') === 'episodes' &&
    sameSafetyId(currentSiteId, safeSiteId) &&
    sameSafetyId(currentRecipientId, safeOriginRecipientId);

  if (matchesCurrentEpisodeContext) {
    const validFrameKey = sanitizeSafetyFrameKey(current.get('frameKey'));
    if (validFrameKey) {
      search.set('frameKey', validFrameKey);
    }
    const validCameraId = sanitizeSafetyUuid(current.get('cameraId'));
    if (validCameraId) {
      search.set('cameraId', validCameraId.toLowerCase());
    }
  }

  return (
    <Link
      className="inline-flex rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold focus-visible:outline-2"
      to={`/incidents?${search}`}
    >
      {tSafety(REQUEST_ID_LINK_KEY)}
    </Link>
  );
}
