import { useTranslation } from 'react-i18next';
import type {
  ObservationIdentityDecisionResponse,
  SafetyEpisode,
  SafetyEpisodeEvidenceRef,
} from '@smartsite/contracts';
import { SAFETY_NAMESPACE, uiLocale } from '../../../i18n';
import { localizedLabel } from '../../../i18n/labels';
import { formatCandidateSubtype } from '../../alerts/safetyAlertEvidenceUtils';
import { buttonClass, cardClass } from '../safety-workflow';
import { StatusBadge, TechnicalDetails } from '../SafetyWorkflowUi';
import './episode-catalog';

export interface SafetyEpisodeContextLabels {
  site?: string;
  camera?: string;
}

export interface SafetyEpisodeDetailProps {
  episode: SafetyEpisode;
  contextLabels?: SafetyEpisodeContextLabels;
  onSelectFinding: (alertId: string) => void;
  onRequestEvidence?: (ref: SafetyEpisodeEvidenceRef) => void;
}

function formatEpisodeTimestamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString(uiLocale());
}

function isMatchingSubjectDecision(
  episode: SafetyEpisode,
  decision: ObservationIdentityDecisionResponse | null,
): decision is ObservationIdentityDecisionResponse {
  if (
    !decision ||
    decision.scope !== 'EXACT_OBSERVATION' ||
    decision.verificationMethod !== 'MANUAL'
  ) {
    return false;
  }
  return (
    decision.subjectRef.eventId === episode.subject.eventId &&
    decision.subjectRef.personObservationIndex === episode.subject.personObservationIndex &&
    decision.subjectRef.cameraId === episode.cameraId
  );
}

function isMatchingSubjectEvidenceRef(
  episode: SafetyEpisode,
  ref: SafetyEpisodeEvidenceRef,
): boolean {
  return (
    episode.subject.kind === 'EVENT_LOCAL' &&
    ref.eventId === episode.subject.eventId &&
    ref.personObservationIndex === episode.subject.personObservationIndex
  );
}

export function SafetyEpisodeDetail({
  episode,
  contextLabels,
  onSelectFinding,
  onRequestEvidence,
}: SafetyEpisodeDetailProps) {
  const { t } = useTranslation(SAFETY_NAMESPACE);

  const validDecision = isMatchingSubjectDecision(episode, episode.identityDecision)
    ? episode.identityDecision
    : null;
  const isResolvedWorker =
    validDecision !== null &&
    validDecision.action === 'RESOLVE' &&
    typeof validDecision.workerId === 'string' &&
    validDecision.workerId.trim().length > 0;
  const isClearedIdentity = validDecision !== null && validDecision.action === 'CLEAR';

  const siteDisplay = contextLabels?.site?.trim() || t('episode.detail.siteFallback');
  const cameraDisplay = contextLabels?.camera?.trim() || t('episode.detail.cameraFallback');

  return (
    <section
      aria-label={t('episode.detail.regionAria')}
      data-testid="safety-episode-detail"
      className={`${cardClass} text-[var(--text-body)]`}
    >
      {/* 1. Operator Header: Person in this image + Identity & Collection Badges */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2
            data-testid="safety-episode-subject-heading"
            className="break-words [overflow-wrap:anywhere] text-base font-bold"
          >
            {t('episode.detail.subjectTitle')}
          </h2>
          <p
            data-testid="safety-episode-collection-note"
            className="break-words [overflow-wrap:anywhere] text-xs text-[var(--text-secondary)]"
          >
            {t(
              episode.collectionState === 'SEALED'
                ? 'episode.detail.sealedNote'
                : 'episode.detail.collectingNote',
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div data-testid="safety-episode-identity-badge">
            {isResolvedWorker ? (
              <StatusBadge value="VERIFIED" text={t('episode.detail.identityResolvedBadge')} />
            ) : isClearedIdentity ? (
              <StatusBadge value="CLOSED" text={t('episode.detail.identityClearedBadge')} />
            ) : (
              <StatusBadge value="UNKNOWN" text={t('episode.detail.identityUnknownBadge')} />
            )}
          </div>
          <div data-testid="safety-episode-collection-badge">
            <StatusBadge
              value={episode.collectionState === 'SEALED' ? 'CLOSED' : 'IN_PROGRESS'}
              text={t(
                episode.collectionState === 'SEALED'
                  ? 'episode.detail.collectionSealed'
                  : 'episode.detail.collectionCollecting',
              )}
            />
          </div>
        </div>
      </header>

      {/* 2. Flat Context & Identity Summary (No raw UUIDs or array indices) */}
      <dl
        data-testid="safety-episode-context"
        className="grid grid-cols-1 gap-2.5 border-b border-[var(--border)] pb-3 text-xs sm:grid-cols-2"
      >
        <div className="min-w-0">
          <dt className="font-medium text-[var(--text-secondary)]">
            {t('episode.detail.siteLabel')}
          </dt>
          <dd
            data-testid="safety-episode-site-display"
            className="mt-0.5 font-semibold break-words [overflow-wrap:anywhere]"
          >
            {siteDisplay}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-[var(--text-secondary)]">
            {t('episode.detail.cameraLabel')}
          </dt>
          <dd
            data-testid="safety-episode-camera-display"
            className="mt-0.5 font-semibold break-words [overflow-wrap:anywhere]"
          >
            {cameraDisplay}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-[var(--text-secondary)]">
            {t('episode.detail.firstObservedLabel')}
          </dt>
          <dd className="mt-0.5 font-mono tabular-nums font-semibold break-words [overflow-wrap:anywhere]">
            {formatEpisodeTimestamp(episode.firstObservedAt)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-medium text-[var(--text-secondary)]">
            {t('episode.detail.lastObservedLabel')}
          </dt>
          <dd className="mt-0.5 font-mono tabular-nums font-semibold break-words [overflow-wrap:anywhere]">
            {formatEpisodeTimestamp(episode.lastObservedAt)}
          </dd>
        </div>
        <div data-testid="safety-episode-identity-panel" className="min-w-0 sm:col-span-2">
          <dt className="font-medium text-[var(--text-secondary)]">
            {t('episode.detail.identityLabel')}
          </dt>
          <dd className="mt-0.5 font-semibold break-words [overflow-wrap:anywhere]">
            {isResolvedWorker
              ? t('episode.detail.identityResolvedNote')
              : isClearedIdentity
                ? t('episode.detail.identityClearedNote')
                : t('episode.detail.identityUnknownNote')}
          </dd>
        </div>
      </dl>

      {/* 3. Flat Findings Section (Independent review actions, no confirm-all) */}
      <div
        data-testid="safety-episode-findings-panel"
        className="space-y-2.5 border-b border-[var(--border)] pb-3"
      >
        <h3 className="text-sm font-bold break-words [overflow-wrap:anywhere]">
          {t('episode.detail.findingsHeading', { replace: { count: episode.findings.length } })}
        </h3>

        {episode.findings.length === 0 ? (
          <p role="status" className="text-xs text-[var(--text-secondary)]">
            {t('episode.detail.findingsEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {episode.findings.map((finding) => {
              const findingHeadingId = `episode-${episode.id}-finding-${finding.alertId}`;
              return (
                <li
                  key={finding.alertId}
                  data-testid={`episode-finding-item-${finding.alertId}`}
                  className="space-y-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p
                          id={findingHeadingId}
                          className="font-semibold text-sm break-words [overflow-wrap:anywhere]"
                        >
                          {formatCandidateSubtype(finding.candidateSubtype)}
                        </p>
                        <StatusBadge value={finding.status} />
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] break-words [overflow-wrap:anywhere]">
                        {localizedLabel(finding.alertType)}
                        {' · '}
                        {finding.zoneId
                          ? t('episode.detail.zoneLinked')
                          : t('episode.detail.zoneUnresolved')}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid={`episode-finding-review-${finding.alertId}`}
                      aria-describedby={findingHeadingId}
                      onClick={() => onSelectFinding(finding.alertId)}
                      className={`${buttonClass} shrink-0 min-h-8 px-3 py-1.5 text-xs focus-visible:outline-2`}
                    >
                      {t('episode.detail.reviewFindingBtn')}
                    </button>
                  </div>

                  {finding.evidenceRefs.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                      {t('episode.detail.evidenceEmpty')}
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {finding.evidenceRefs.map((ref) => {
                        const refKey = `${finding.alertId}-${ref.eventId}-${ref.personObservationIndex}-${ref.evidenceIndex}`;
                        const isSubjectBound = isMatchingSubjectEvidenceRef(episode, ref);
                        const canRequest =
                          isSubjectBound &&
                          ref.available === true &&
                          typeof onRequestEvidence === 'function';
                        return canRequest ? (
                          <button
                            key={refKey}
                            type="button"
                            data-testid={`episode-evidence-btn-${finding.alertId}-${ref.evidenceIndex}`}
                            onClick={() => onRequestEvidence(ref)}
                            className={`${buttonClass} min-h-7 px-2.5 py-1 text-xs focus-visible:outline-2`}
                          >
                            {t('episode.detail.requestEvidenceBtn', {
                              index: ref.evidenceIndex,
                            })}
                            {' · '}
                            {t('episode.detail.evidenceAvailable')}
                          </button>
                        ) : (
                          <span
                            key={refKey}
                            data-testid={`episode-evidence-status-${finding.alertId}-${ref.evidenceIndex}`}
                            className="inline-flex items-center rounded-md bg-[var(--surface-bone)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]"
                          >
                            {t('episode.detail.evidenceItemLabel', {
                              index: ref.evidenceIndex,
                            })}
                            {' · '}
                            {!isSubjectBound
                              ? t('episode.detail.evidenceUnbound')
                              : t(
                                  ref.available
                                    ? 'episode.detail.evidenceAvailable'
                                    : 'episode.detail.evidenceUnavailable',
                                )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 4. Linked Workflow Summary (if any) */}
      {episode.workflowLinks.length > 0 && (
        <div
          data-testid="safety-episode-workflow-links"
          className="space-y-2 border-b border-[var(--border)] pb-3 text-xs"
        >
          <h3 className="font-semibold text-[var(--text-secondary)]">
            {t('episode.detail.workflowHeading')}
          </h3>
          <ul className="space-y-1.5">
            {episode.workflowLinks.map((link, idx) => (
              <li key={link.incidentId} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">
                  {t('episode.detail.incidentLabel', { index: idx + 1 })}
                </span>
                <StatusBadge value={link.status} />
                {link.actions.map((act, actIdx) => (
                  <span key={act.actionId} className="inline-flex items-center gap-1.5">
                    <span className="text-[var(--text-secondary)]">·</span>
                    <span>{t('episode.detail.actionLabel', { index: actIdx + 1 })}</span>
                    <StatusBadge value={act.status} />
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Technical Details Disclosure (Index, Event/Site/Camera/Worker/Zone UUIDs, Revisions, Hashes, Bundle) */}
      <TechnicalDetails key={`${episode.id}:${episode.contentRevision}`}>
        <p className="font-mono">{t('episode.detail.techEpisodeLine', { id: episode.id, revision: episode.contentRevision, findingCount: episode.findingCount })}</p>
        <p className="font-mono">{t('episode.detail.techContextLine', { siteId: episode.siteId, cameraId: episode.cameraId })}</p>
        <p className="font-mono">{t('episode.detail.techSubjectLine', { kind: episode.subject.kind, eventId: episode.subject.eventId, index: episode.subject.personObservationIndex })}</p>
        <p className="font-mono">{episode.configurationBundleId ? t('episode.detail.techBundleActive', { bundleId: episode.configurationBundleId }) : t('episode.detail.techBundleNull')}</p>
        {isResolvedWorker && validDecision && validDecision.workerId && (
          <p className="font-mono">{t('episode.detail.techIdentityResolved', { id: validDecision.id, revision: validDecision.revision, workerId: validDecision.workerId })}</p>
        )}
        {isClearedIdentity && validDecision && (
          <p className="font-mono">{t('episode.detail.techIdentityCleared', { id: validDecision.id, revision: validDecision.revision })}</p>
        )}
        {episode.findings.map((finding) => (
          <div key={`tech-${finding.alertId}`} className="space-y-0.5 border-t border-[var(--border)] pt-1 font-mono">
            <p>{t('episode.detail.techFindingLine', { alertId: finding.alertId, revision: finding.alertRevision, zoneId: finding.zoneId ?? 'null' })}</p>
            {finding.evidenceRefs.map((ref) => (
              <p key={`tech-ref-${finding.alertId}-${ref.eventId}-${ref.personObservationIndex}-${ref.evidenceIndex}`}>
                {t('episode.detail.techEvidenceLine', { eventId: ref.eventId, personIndex: ref.personObservationIndex, evidenceIndex: ref.evidenceIndex, sha256: ref.sha256 })}
              </p>
            ))}
          </div>
        ))}
        {episode.workflowLinks.map((link) => (
          <p key={`tech-wf-${link.incidentId}`} className="font-mono">
            {t('episode.detail.techWorkflowLine', { incidentId: link.incidentId, actionIds: link.actions.map((a) => a.actionId).join(', ') || 'none' })}
          </p>
        ))}
      </TechnicalDetails>
    </section>
  );
}
