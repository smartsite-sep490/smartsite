import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { LoginResponse } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import './tracked-episode-workspace-catalog';
import { Card } from '../ui';
import { SafetyEpisodeInbox as Inbox } from './SafetyEpisodeInbox';
import { FramePpeInbox } from '../../FramePpeInbox';
import {
  isSafetyIdentificationRouteEnabled,
  matchCanonicalId,
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
  uniqueCanonicalIds,
} from './safetyUrlParams';

const IdentificationWorkspace = lazy(() =>
  import('../safety-identification/SafetyIdentificationWorkspace').then((module) => ({
    default: module.SafetyIdentificationWorkspace,
  })),
);

type Session = Pick<LoginResponse, 'accessToken' | 'user'>;

interface Props {
  apiUrl: string;
  session: Session | null;
  children: ReactNode;
  enableIdentification?: boolean;
  onSignOut?: () => void;
}

/** Adds a recipient view without changing existing incident/task/review routing. */
export function SafetyEpisodeWorkspace({
  session,
  children,
  enableIdentification,
  ...props
}: Props) {
  const { t } = useTranslation();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const [params, setParams] = useSearchParams();
  const roles = JSON.stringify(session?.user.roleAssignments ?? []);
  const [credential, setCredential] = useState(() => ({
    token: session?.accessToken,
    user: session?.user.id,
    roles,
    nonce: crypto.randomUUID(),
  }));
  if (
    credential.token !== session?.accessToken ||
    credential.user !== session?.user.id ||
    credential.roles !== roles
  ) {
    setCredential({
      token: session?.accessToken,
      user: session?.user.id,
      roles,
      nonce: crypto.randomUUID(),
    });
  }

  const sites = uniqueCanonicalIds(
    session?.user.roleAssignments.flatMap((r) =>
      r.role === 'SAFETY_OFFICER' && r.siteId ? [r.siteId] : [],
    ) ?? [],
  );
  const identificationSites = uniqueCanonicalIds(
    session?.user.roleAssignments.flatMap((r) =>
      r.siteId && ['SAFETY_OFFICER', 'SITE_MANAGER'].includes(r.role) ? [r.siteId] : [],
    ) ?? [],
  );

  const c02Enabled = isSafetyIdentificationRouteEnabled(enableIdentification);
  const frameGrouped = params.get('tab') === 'ppe-frames';
  const grouped = params.get('tab') === 'episodes' || frameGrouped;
  const identification = c02Enabled && params.get('tab') === 'identification';

  const rawSiteParam = params.get('siteId');
  const matchedOfficerSiteId = matchCanonicalId(sites, rawSiteParam);
  const matchedIdentificationSiteId = matchCanonicalId(identificationSites, rawSiteParam);
  const scopedSite = Boolean(matchedOfficerSiteId);
  const identificationScopedSite = Boolean(matchedIdentificationSiteId);
  const siteId = matchedOfficerSiteId ?? matchedIdentificationSiteId;

  const originCameraId = sanitizeSafetyUuid(params.get('cameraId'))?.toLowerCase();
  const frameTarget = new URLSearchParams({ tab: 'ppe-frames' });
  if (matchedOfficerSiteId) frameTarget.set('siteId', matchedOfficerSiteId);
  if (matchedOfficerSiteId && originCameraId) frameTarget.set('cameraId', originCameraId);

  const originFrameKey = sanitizeSafetyFrameKey(params.get('frameKey'));
  const validRecipientId = sanitizeSafetyQueryId(params.get('recipientId'));
  const validOriginRecipientId = sanitizeSafetyUuid(params.get('originRecipientId'));
  const validInitialEpisodeId = sanitizeSafetyQueryId(params.get('episodeId'));

  const returnToFrame =
    grouped && !frameGrouped && scopedSite && Boolean(validRecipientId) && Boolean(originFrameKey);
  if (returnToFrame && originFrameKey) frameTarget.set('frameKey', originFrameKey);
  const returnToFrameHref = returnToFrame ? `/incidents?${frameTarget}` : undefined;

  const target = new URLSearchParams();
  if (matchedOfficerSiteId) target.set('siteId', matchedOfficerSiteId);
  if (!grouped) target.set('tab', 'episodes');
  const targetHref = target.size > 0 ? `/incidents?${target}` : '/incidents';

  let identificationBackHref = '/incidents';
  let identificationBackLabel = t('episodes.back');
  if (matchedOfficerSiteId && validOriginRecipientId) {
    const backSearch = new URLSearchParams({
      tab: 'episodes',
      siteId: matchedOfficerSiteId,
      recipientId: validOriginRecipientId,
    });
    if (originFrameKey) backSearch.set('frameKey', originFrameKey);
    if (originCameraId) backSearch.set('cameraId', originCameraId);
    identificationBackHref = `/incidents?${backSearch}`;
    identificationBackLabel = tSafety('episodes.identificationBackToEpisode');
  } else if (matchedOfficerSiteId && originFrameKey) {
    const backSearch = new URLSearchParams({ tab: 'ppe-frames', siteId: matchedOfficerSiteId });
    if (originCameraId) backSearch.set('cameraId', originCameraId);
    backSearch.set('frameKey', originFrameKey);
    identificationBackHref = `/incidents?${backSearch}`;
    identificationBackLabel = t('frameInbox.backToFrame');
  } else if (matchedIdentificationSiteId) {
    identificationBackHref = `/incidents?${new URLSearchParams({ siteId: matchedIdentificationSiteId })}`;
  }

  const allowed =
    Boolean(session?.accessToken) &&
    Boolean(session?.user.isActive) &&
    !session?.user.mustChangePassword &&
    sites.length > 0;
  const identificationAllowed =
    c02Enabled &&
    Boolean(session?.accessToken) &&
    Boolean(session?.user.isActive) &&
    !session?.user.mustChangePassword &&
    identificationSites.length > 0;

  const identificationTarget = new URLSearchParams({ tab: 'identification' });
  if (matchedIdentificationSiteId) identificationTarget.set('siteId', matchedIdentificationSiteId);

  if (identification && !identificationAllowed) {
    return <Card role="alert">{t('episodes.denied')}</Card>;
  }
  if (grouped && !allowed) {
    return (
      <Card role="alert">
        <p>{t('episodes.denied')}</p>
        <Link className="underline" to={targetHref}>
          {t('episodes.back')}
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {(allowed || identificationAllowed) && (
        <nav
          aria-label={t('episodes.views')}
          className="flex flex-wrap items-center justify-between gap-3"
        >
          <p className="text-sm text-slate-600">
            {identification
              ? tSafety('episodes.identificationWorkspaceIntro')
              : frameGrouped
                ? t('frameInbox.intro')
                : grouped
                  ? t('episodes.intro')
                  : t('episodes.entryHint')}
          </p>
          {allowed && !frameGrouped && !identification && (
            <Link
              className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2"
              to={`/incidents?${frameTarget}`}
            >
              {t(returnToFrame ? 'frameInbox.backToFrame' : 'episodes.frameTitle')}
            </Link>
          )}
          {(allowed || identification) && (
            <Link
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold focus-visible:outline-2"
              to={identification ? identificationBackHref : targetHref}
            >
              {identification
                ? identificationBackLabel
                : t(grouped ? 'episodes.back' : 'episodes.title')}
            </Link>
          )}
          {identificationAllowed && !identification && (
            <Link
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold focus-visible:outline-2"
              to={`/incidents?${identificationTarget}`}
            >
              {tSafety('episodes.identificationWorkspaceNav')}
            </Link>
          )}
        </nav>
      )}
      {identification && identificationAllowed && session ? (
        <Suspense
          fallback={<Card role="status">{tSafety('episodes.identificationWorkspaceLoading')}</Card>}
        >
          <IdentificationWorkspace
            key={credential.nonce}
            {...props}
            session={session}
            initialSiteId={identificationScopedSite ? siteId : undefined}
            initialEpisodeId={validInitialEpisodeId}
            originRecipientId={scopedSite ? validOriginRecipientId : undefined}
            originFrameKey={scopedSite ? originFrameKey : undefined}
            originCameraId={scopedSite ? originCameraId : undefined}
            onClearOrigin={() => {
              if (
                !params.has('episodeId') &&
                !params.has('originRecipientId') &&
                !params.has('frameKey') &&
                !params.has('cameraId')
              ) {
                return;
              }
              const next = new URLSearchParams(params);
              next.delete('episodeId');
              next.delete('originRecipientId');
              next.delete('frameKey');
              next.delete('cameraId');
              setParams(next, { replace: true });
            }}
            onActiveSiteChange={(nextSiteId) => {
              const matchedNextSite = matchCanonicalId(identificationSites, nextSiteId);
              if (!matchedNextSite) return;
              const next = new URLSearchParams(params);
              next.set('siteId', matchedNextSite);
              next.delete('episodeId');
              next.delete('originRecipientId');
              next.delete('frameKey');
              next.delete('cameraId');
              setParams(next, { replace: true });
            }}
          />
        </Suspense>
      ) : frameGrouped && allowed && session ? (
        <FramePpeInbox apiUrl={props.apiUrl} session={session} />
      ) : grouped && session ? (
        <Inbox
          key={credential.nonce}
          {...props}
          session={session}
          scope={credential.nonce}
          sites={sites}
          returnToFrameHref={returnToFrameHref}
        />
      ) : (
        children
      )}
    </div>
  );
}
