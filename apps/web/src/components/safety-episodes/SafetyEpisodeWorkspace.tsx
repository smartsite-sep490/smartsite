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
  const identificationReturnsToFrame =
    identification &&
    Boolean(matchedOfficerSiteId) &&
    !validOriginRecipientId &&
    Boolean(originFrameKey);
  if ((returnToFrame || identificationReturnsToFrame) && originFrameKey) {
    frameTarget.set('frameKey', originFrameKey);
  }
  const returnToFrameHref = returnToFrame ? `/incidents?${frameTarget}` : undefined;

  const baseSafetySearch = new URLSearchParams();
  if (matchedOfficerSiteId) {
    baseSafetySearch.set('siteId', matchedOfficerSiteId);
  } else if (matchedIdentificationSiteId) {
    baseSafetySearch.set('siteId', matchedIdentificationSiteId);
  }
  const baseSafetyHref = baseSafetySearch.size > 0 ? `/incidents?${baseSafetySearch}` : '/incidents';

  const target = new URLSearchParams();
  if (matchedOfficerSiteId) target.set('siteId', matchedOfficerSiteId);
  if (!grouped) target.set('tab', 'episodes');
  const targetHref = target.size > 0 ? `/incidents?${target}` : '/incidents';

  const episodeNavSearch = new URLSearchParams({ tab: 'episodes' });
  if (matchedOfficerSiteId) episodeNavSearch.set('siteId', matchedOfficerSiteId);
  let episodeNavHref = `/incidents?${episodeNavSearch}`;
  let episodeNavLabel = t('episodes.title');
  if (identification && matchedOfficerSiteId && validOriginRecipientId) {
    const backSearch = new URLSearchParams({
      tab: 'episodes',
      siteId: matchedOfficerSiteId,
      recipientId: validOriginRecipientId,
    });
    if (originFrameKey) backSearch.set('frameKey', originFrameKey);
    if (originCameraId) backSearch.set('cameraId', originCameraId);
    episodeNavHref = `/incidents?${backSearch}`;
    episodeNavLabel = tSafety('episodes.identificationBackToEpisode');
  }

  const isOperationsActive = !grouped && !identification;
  const isFrameActive = frameGrouped;
  const isEpisodeActive = grouped && !frameGrouped;
  const isIdentificationActive = identification;

  const navPillClass = (active: boolean) =>
    active
      ? 'inline-flex min-h-9 items-center justify-center rounded-lg bg-[#0F172A] px-3.5 py-1.5 text-sm font-semibold text-white shadow-2xs transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'
      : 'inline-flex min-h-9 items-center justify-center rounded-lg px-3.5 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-white hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900';

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
    <div className="w-full min-w-0 space-y-3.5">
      {(allowed || identificationAllowed) && (
        <nav
          aria-label={t('episodes.views')}
          data-testid="safety-workspace-mode-bar"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-slate-200/90 bg-white px-4 py-2.5 shadow-2xs sm:px-5"
        >
          <p className="min-w-[min(100%,20rem)] flex-1 text-xs sm:text-sm leading-snug text-slate-600">
            {identification
              ? tSafety('episodes.identificationWorkspaceIntro')
              : frameGrouped
                ? t('frameInbox.intro')
                : grouped
                  ? t('episodes.intro')
                  : t('episodes.entryHint')}
          </p>
          <div
            data-testid="safety-workspace-mode-actions"
            className="flex flex-wrap items-center gap-1 rounded-xl border border-slate-200/80 bg-slate-100/90 p-1"
          >
            <Link
              aria-current={isOperationsActive ? 'page' : undefined}
              className={navPillClass(isOperationsActive)}
              to={baseSafetyHref}
            >
              {t('episodes.back')}
            </Link>
            {allowed && (
              <Link
                aria-current={isFrameActive ? 'page' : undefined}
                className={navPillClass(isFrameActive)}
                to={`/incidents?${frameTarget}`}
              >
                {t(
                  returnToFrame || identificationReturnsToFrame
                    ? 'frameInbox.backToFrame'
                    : 'episodes.frameTitle',
                )}
              </Link>
            )}
            {allowed && (
              <Link
                aria-current={isEpisodeActive ? 'page' : undefined}
                className={navPillClass(isEpisodeActive)}
                to={episodeNavHref}
              >
                {episodeNavLabel}
              </Link>
            )}
            {identificationAllowed && (
              <Link
                aria-current={isIdentificationActive ? 'page' : undefined}
                className={navPillClass(isIdentificationActive)}
                to={`/incidents?${identificationTarget}`}
              >
                {tSafety('episodes.identificationWorkspaceNav')}
              </Link>
            )}
          </div>
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
